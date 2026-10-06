package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"onekey/server/internal/cryptox"
)

// ─────────────────────────── Account groups ───────────────────────────
//
// An organisational label on accounts, deliberately separate from `role`.
// `role` is a permission system — its rows are menu and button entries that
// decide what an account may reach — so hanging "is this customer support?"
// off it would conflate two unrelated questions and make both harder to
// answer. A group answers only "which accounts do I want to look at together",
// and its one consumer is the usage filter.
//
// Membership is many-to-many: an account can sit in both "support" and "vip",
// and filtering on either must find its traffic.

const accountGroupCols = "id,name,remark,create_time,update_time,delete_time"

// accountGroupColsQualified — the same list prefixed with a table alias, for the
// membership join. Both account_group and account_group_member have an id, so an
// unqualified column list is ambiguous there.
const accountGroupColsQualified = "g.id,g.name,g.remark,g.create_time,g.update_time,g.delete_time"

type AccountGroup struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Remark     string `json:"remark"`
	CreateTime int64  `json:"create_time"`
	UpdateTime *int64 `json:"update_time"`
	DeleteTime *int64 `json:"delete_time"`
	// MemberCount is filled by the list query so the admin page can show a size
	// without a second round trip per row.
	MemberCount int64 `json:"member_count"`
}

func scanAccountGroup(row interface{ Scan(...any) error }) (*AccountGroup, error) {
	g := &AccountGroup{}
	err := row.Scan(&g.ID, &g.Name, &g.Remark, &g.CreateTime, &g.UpdateTime, &g.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return g, nil
}

func (g *AccountGroup) DTO() map[string]any {
	return map[string]any{
		"id": g.ID, "name": g.Name, "remark": g.Remark,
		"member_count": g.MemberCount,
		"create_time":  g.CreateTime, "update_time": g.UpdateTime, "delete_time": g.DeleteTime,
	}
}

// AccountGroupList — every live group with its member count.
//
// The count is a correlated subquery rather than a JOIN ... GROUP BY: the join
// would have to be grouped on every selected column, and a group with no members
// would drop out of the list entirely — exactly the group an admin is most
// likely to be about to fill.
func AccountGroupList(db *sql.DB) ([]*AccountGroup, error) {
	rows, err := db.Query(`SELECT ` + accountGroupCols + `,
			(SELECT COUNT(*) FROM account_group_member m
			  WHERE m.group_id = account_group.id AND m.delete_time IS NULL)
		FROM account_group WHERE delete_time IS NULL ORDER BY create_time ASC, rowid ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AccountGroup{}
	for rows.Next() {
		g := &AccountGroup{}
		if err := rows.Scan(&g.ID, &g.Name, &g.Remark, &g.CreateTime, &g.UpdateTime, &g.DeleteTime, &g.MemberCount); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func AccountGroupFindOne(db *sql.DB, id string) (*AccountGroup, error) {
	g, err := scanAccountGroup(db.QueryRow(
		"SELECT "+accountGroupCols+" FROM account_group WHERE id = ? AND delete_time IS NULL", id))
	if err != nil {
		return nil, err
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM account_group_member
		WHERE group_id = ? AND delete_time IS NULL`, id).Scan(&g.MemberCount); err != nil {
		return nil, err
	}
	return g, nil
}

// AccountGroupByName — used to reject a duplicate name before insert, so the
// admin sees a clear error instead of a unique-index failure.
func AccountGroupByName(db *sql.DB, name string) (*AccountGroup, error) {
	return scanAccountGroup(db.QueryRow(
		"SELECT "+accountGroupCols+" FROM account_group WHERE name = ? AND delete_time IS NULL", name))
}

// AccountGroupMemberIDs — the accounts in a group.
func AccountGroupMemberIDs(db *sql.DB, groupID string) ([]string, error) {
	rows, err := db.Query(`SELECT account_id FROM account_group_member
		WHERE group_id = ? AND delete_time IS NULL ORDER BY create_time ASC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// AccountGroupsOf — the groups an account belongs to, for the account detail
// panel.
func AccountGroupsOf(db *sql.DB, accountID string) ([]*AccountGroup, error) {
	rows, err := db.Query(`SELECT `+accountGroupColsQualified+` FROM account_group g
		INNER JOIN account_group_member m ON m.group_id = g.id
		WHERE m.account_id = ? AND m.delete_time IS NULL AND g.delete_time IS NULL
		ORDER BY g.create_time ASC`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AccountGroup{}
	for rows.Next() {
		g, err := scanAccountGroup(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// AccountGroupMemberIDsMany — resolve several groups to the union of their
// members in one query.
//
// This is what the usage filter calls. Resolving per group and merging in Go
// would send one query per selected group, and the caller only ever wants the
// union: an account in two selected groups must contribute its traffic once,
// which DISTINCT guarantees and a per-group loop would not.
func AccountGroupMemberIDsMany(db *sql.DB, groupIDs []string) ([]string, error) {
	if len(groupIDs) == 0 {
		return nil, nil
	}
	ph := strings.Repeat("?,", len(groupIDs))
	ph = ph[:len(ph)-1]
	args := make([]any, 0, len(groupIDs))
	for _, id := range groupIDs {
		args = append(args, id)
	}
	rows, err := db.Query(`SELECT DISTINCT m.account_id FROM account_group_member m
		INNER JOIN account_group g ON g.id = m.group_id
		WHERE m.delete_time IS NULL AND g.delete_time IS NULL
		  AND m.group_id IN (`+ph+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// AccountGroupCreate — insert a group after checking the name is free.
func AccountGroupCreate(db *sql.DB, name, remark string) (*AccountGroup, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("Group name is required")
	}
	if existing, err := AccountGroupByName(db, name); err == nil && existing != nil {
		return nil, fmt.Errorf("Group %q already exists", name)
	} else if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	row, err := GenericInsert(db, "account_group", map[string]any{"name": name, "remark": remark})
	if err != nil {
		return nil, err
	}
	id, _ := row["id"].(string)
	return AccountGroupFindOne(db, id)
}

// AccountGroupUpdate — rename and/or re-describe a group.
func AccountGroupUpdate(db *sql.DB, id, name, remark string) (*AccountGroup, error) {
	if _, err := AccountGroupFindOne(db, id); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("Group name is required")
	}
	// A rename onto another live group's name would break the unique index, so
	// it is rejected here with a message that names the conflict.
	if existing, err := AccountGroupByName(db, name); err == nil && existing != nil && existing.ID != id {
		return nil, fmt.Errorf("Group %q already exists", name)
	} else if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if err := GenericUpdateByID(db, "account_group", id, map[string]any{"name": name, "remark": remark}); err != nil {
		return nil, err
	}
	return AccountGroupFindOne(db, id)
}

// AccountGroupDelete — soft-delete the group and its membership rows.
//
// Memberships go too: a live membership pointing at a deleted group would keep
// that account resolvable by a group filter that no longer appears in the UI.
func AccountGroupDelete(db *sql.DB, id string) error {
	if _, err := AccountGroupFindOne(db, id); err != nil {
		return err
	}
	now := Now()
	if _, err := db.Exec(
		"UPDATE account_group_member SET delete_time = ?, update_time = ? WHERE group_id = ? AND delete_time IS NULL",
		now, now, id); err != nil {
		return err
	}
	InvalidateRefCache()
	return GenericSoftDelete(db, "account_group", id)
}

// AccountGroupAssignMembers — replace a group's membership with exactly this
// set, mirroring AssignPermissions.
//
// Replace rather than add/remove: the admin UI is a checkbox list, and a
// replace makes "uncheck and save" work without a separate removal call. The
// soft delete keeps the rows for the sync layer, which carries deletes as
// tombstones.
func AccountGroupAssignMembers(db *sql.DB, groupID string, accountIDs []string) error {
	if _, err := AccountGroupFindOne(db, groupID); err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := Now()

	current := map[string]bool{}
	rows, err := tx.Query("SELECT account_id FROM account_group_member WHERE group_id = ? AND delete_time IS NULL", groupID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		current[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	var added, revived, removed []string
	want := map[string]bool{}
	for _, id := range accountIDs {
		if id == "" || want[id] {
			continue
		}
		want[id] = true
		if current[id] {
			continue
		}
		// A membership that was soft-deleted earlier is revived rather than
		// duplicated: the unique index is on (group_id, account_id) and does not
		// exclude deleted rows, so an insert would collide with the tombstone.
		var revivedID string
		err := tx.QueryRow(`SELECT id FROM account_group_member
			WHERE group_id = ? AND account_id = ?`, groupID, id).Scan(&revivedID)
		if err == nil {
			if _, err := tx.Exec(`UPDATE account_group_member
				SET delete_time = NULL, update_time = ? WHERE id = ?`, now, revivedID); err != nil {
				return err
			}
			revived = append(revived, id)
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO account_group_member
			(id, group_id, account_id, create_time, update_time, delete_time)
			VALUES (?, ?, ?, ?, ?, NULL)`, cryptox.Nanoid(6), groupID, id, now, now); err != nil {
			return err
		}
		added = append(added, id)
	}

	for id := range current {
		if want[id] {
			continue
		}
		set, err := tx.Exec(`UPDATE account_group_member
			SET delete_time = ?, update_time = ? WHERE group_id = ? AND account_id = ? AND delete_time IS NULL`,
			now, now, groupID, id)
		if err != nil {
			return err
		}
		if n, _ := set.RowsAffected(); n > 0 {
			// Buffered after the commit below, keyed on the pair.
			removed = append(removed, id)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	// Queue the changes now that the rows are committed. A replica has to learn
	// both directions: a new member it should count, and a departure it must stop
	// counting.
	for _, id := range append(append([]string{}, added...), revived...) {
		_ = EnqueuePut(db, "account_group_member", memberRowKey(groupID, id), map[string]any{
			"group_id": groupID, "account_id": id, "delete_time": nil,
		})
	}
	for _, id := range removed {
		_ = EnqueuePut(db, "account_group_member", memberRowKey(groupID, id), map[string]any{
			"group_id": groupID, "account_id": id, "delete_time": now,
		})
	}
	InvalidateRefCache()
	return nil
}

// memberRowKey — the outbox row key for a membership, mirroring the composite
// conflict key so the two agree on row identity.
func memberRowKey(groupID, accountID string) string {
	return groupID + ":" + accountID
}

// AccountGroupAddMember — put one account in one group, used by the account
// page so an admin editing an account does not have to open the group page.
func AccountGroupAddMember(db *sql.DB, groupID, accountID string) error {
	return setMembership(db, groupID, accountID, true)
}

// AccountGroupRemoveMember — the inverse of AccountGroupAddMember.
func AccountGroupRemoveMember(db *sql.DB, groupID, accountID string) error {
	return setMembership(db, groupID, accountID, false)
}

// setMembership adds or removes a single (group, account) pair.
//
// Adding revives a soft-deleted row instead of inserting a second one: the
// unique index is on (group_id, account_id) and does not exclude tombstones, so
// re-adding a previously removed member would otherwise collide.
func setMembership(db *sql.DB, groupID, accountID string, add bool) error {
	if _, err := AccountGroupFindOne(db, groupID); err != nil {
		return err
	}
	now := Now()
	var existing string
	err := db.QueryRow("SELECT id FROM account_group_member WHERE group_id = ? AND account_id = ?",
		groupID, accountID).Scan(&existing)

	if errors.Is(err, sql.ErrNoRows) {
		if !add {
			return nil // already not a member
		}
		if _, err := db.Exec(`INSERT INTO account_group_member
			(id, group_id, account_id, create_time, update_time, delete_time)
			VALUES (?, ?, ?, ?, ?, NULL)`, cryptox.Nanoid(6), groupID, accountID, now, now); err != nil {
			return err
		}
		_ = EnqueuePut(db, "account_group_member", memberRowKey(groupID, accountID), map[string]any{
			"group_id": groupID, "account_id": accountID, "delete_time": nil,
		})
		InvalidateRefCache()
		return nil
	}
	if err != nil {
		return err
	}

	var set any
	if add {
		set = nil
	} else {
		set = now
	}
	if _, err := db.Exec("UPDATE account_group_member SET delete_time = ?, update_time = ? WHERE id = ?",
		set, now, existing); err != nil {
		return err
	}
	_ = EnqueuePut(db, "account_group_member", memberRowKey(groupID, accountID), map[string]any{
		"group_id": groupID, "account_id": accountID, "delete_time": set,
	})
	InvalidateRefCache()
	return nil
}
