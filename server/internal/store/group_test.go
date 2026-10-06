package store

import (
	"testing"
)

// TestAccountGroupNameReusableAfterDelete — deleting a group must free its name.
//
// The unique index has to be partial (live rows only). A plain one leaves the
// soft-deleted row squatting the name forever: the delete reports success while
// every later create with that name fails on the index, which is exactly the
// kind of "it says it worked" bug that is hard to spot from the UI.
func TestAccountGroupNameReusableAfterDelete(t *testing.T) {
	db, err := Open(t.TempDir() + "/groupname.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	first, err := AccountGroupCreate(db, "support", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := AccountGroupDelete(db, first.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	second, err := AccountGroupCreate(db, "support", "reused name")
	if err != nil {
		t.Fatalf("the name was not reusable after delete: %v", err)
	}
	if second.ID == first.ID {
		t.Fatalf("re-create reused the deleted row's id")
	}
	if second.Name != "support" || second.Remark != "reused name" {
		t.Fatalf("re-created group = %+v", second)
	}
	// Only the live one is visible.
	list, err := AccountGroupList(db)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].ID != second.ID {
		t.Fatalf("list = %+v, want only the re-created group", list)
	}
}

// TestAccountGroupMemberReAddableAfterRemove — the same partial-index property
// for the membership pair, which is what stops a removed member from
// permanently blocking that pair.
func TestAccountGroupMemberReAddableAfterRemove(t *testing.T) {
	db, err := Open(t.TempDir() + "/groupreadd2.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	row, err := GenericInsert(db, "account", map[string]any{"name": "ann", "email": "a@e.com", "api_key": "k"})
	if err != nil {
		t.Fatalf("account: %v", err)
	}
	acct := row["id"].(string)
	g, err := AccountGroupCreate(db, "support", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// add -> remove -> add, twice, through the replace-all path the UI uses.
	for i := 0; i < 2; i++ {
		if err := AccountGroupAssignMembers(db, g.ID, []string{acct}); err != nil {
			t.Fatalf("round %d add: %v", i, err)
		}
		if members, _ := AccountGroupMemberIDs(db, g.ID); len(members) != 1 {
			t.Fatalf("round %d: %d members, want 1", i, len(members))
		}
		if err := AccountGroupAssignMembers(db, g.ID, nil); err != nil {
			t.Fatalf("round %d remove: %v", i, err)
		}
		if members, _ := AccountGroupMemberIDs(db, g.ID); len(members) != 0 {
			t.Fatalf("round %d: %d members after removal, want 0", i, len(members))
		}
	}
}

func TestAccountGroupCRUD(t *testing.T) {
	db, err := Open(t.TempDir() + "/groupcrud.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	g, err := AccountGroupCreate(db, "support", "customer support team")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if g.Name != "support" || g.Remark != "customer support team" {
		t.Fatalf("created group = %+v", g)
	}
	if g.MemberCount != 0 {
		t.Fatalf("new group reports %d members, want 0", g.MemberCount)
	}

	// A duplicate name must be refused with a message, not a raw index error:
	// the admin sees this string.
	if _, err := AccountGroupCreate(db, "support", ""); err == nil {
		t.Fatalf("duplicate name was accepted")
	}

	renamed, err := AccountGroupUpdate(db, g.ID, "support-l2", "second line")
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if renamed.Name != "support-l2" || renamed.Remark != "second line" {
		t.Fatalf("updated group = %+v", renamed)
	}

	other, err := AccountGroupCreate(db, "vip", "")
	if err != nil {
		t.Fatalf("create other: %v", err)
	}
	// Renaming onto another live group's name would break the unique index.
	if _, err := AccountGroupUpdate(db, other.ID, "support-l2", ""); err == nil {
		t.Fatalf("rename onto an existing name was accepted")
	}

	if err := AccountGroupDelete(db, g.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := AccountGroupFindOne(db, g.ID); err != ErrNotFound {
		t.Fatalf("deleted group lookup = %v, want ErrNotFound", err)
	}
	list, err := AccountGroupList(db)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].Name != "vip" {
		t.Fatalf("list after delete = %+v", list)
	}
}

// TestAccountGroupMembershipIsResolvable — the property the usage filter
// depends on: a group resolves to its member accounts, and an account in two
// groups is returned once from a union query.
func TestAccountGroupMembershipIsResolvable(t *testing.T) {
	db, err := Open(t.TempDir() + "/groupmember.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	accts := []string{}
	for _, name := range []string{"ann", "bob", "cyd", "dee"} {
		row, err := GenericInsert(db, "account", map[string]any{
			"name": name, "email": name + "@example.com", "api_key": "k" + name,
		})
		if err != nil {
			t.Fatalf("account %s: %v", name, err)
		}
		accts = append(accts, row["id"].(string))
	}

	support, err := AccountGroupCreate(db, "support", "")
	if err != nil {
		t.Fatalf("create support: %v", err)
	}
	vip, err := AccountGroupCreate(db, "vip", "")
	if err != nil {
		t.Fatalf("create vip: %v", err)
	}

	// ann and bob in support; bob also in vip — the overlap is the case that
	// must not double-count.
	if err := AccountGroupAssignMembers(db, support.ID, accts[:2]); err != nil {
		t.Fatalf("assign support: %v", err)
	}
	if err := AccountGroupAssignMembers(db, vip.ID, []string{accts[1], accts[2]}); err != nil {
		t.Fatalf("assign vip: %v", err)
	}

	members, err := AccountGroupMemberIDs(db, support.ID)
	if err != nil {
		t.Fatalf("members: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("support has %d members, want 2", len(members))
	}

	union, err := AccountGroupMemberIDsMany(db, []string{support.ID, vip.ID})
	if err != nil {
		t.Fatalf("union: %v", err)
	}
	// ann, bob, cyd — bob appears in both groups but only once.
	if len(union) != 3 {
		t.Fatalf("union has %d members, want 3 (bob must not repeat): %v", len(union), union)
	}
	seen := map[string]int{}
	for _, id := range union {
		seen[id]++
	}
	if seen[accts[1]] != 1 {
		t.Fatalf("account in two groups appears %d times, want 1", seen[accts[1]])
	}

	// The account-side view must agree.
	groups, err := AccountGroupsOf(db, accts[1])
	if err != nil {
		t.Fatalf("groups of: %v", err)
	}
	if len(groups) != 2 {
		t.Fatalf("bob is in %d groups, want 2", len(groups))
	}

	// The list count the admin page renders.
	list, err := AccountGroupList(db)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	counts := map[string]int64{}
	for _, g := range list {
		counts[g.Name] = g.MemberCount
	}
	if counts["support"] != 2 || counts["vip"] != 2 {
		t.Fatalf("member counts = %v, want support=2 vip=2", counts)
	}

	// Removing membership narrows both directions.
	if err := AccountGroupAssignMembers(db, vip.ID, []string{accts[2]}); err != nil {
		t.Fatalf("reassign vip: %v", err)
	}
	if groups, err := AccountGroupsOf(db, accts[1]); err != nil || len(groups) != 1 {
		t.Fatalf("after removal bob is in %d groups (err %v), want 1", len(groups), err)
	}
}

// TestAccountGroupMemberCanBeRemovedAndReAdded — the (group, account) pair is
// unique, and a removed member leaves a soft-deleted row behind. Re-adding must
// revive that row rather than collide with it.
func TestAccountGroupMemberCanBeRemovedAndReAdded(t *testing.T) {
	db, err := Open(t.TempDir() + "/groupreadd.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	row, err := GenericInsert(db, "account", map[string]any{"name": "ann", "email": "a@e.com", "api_key": "k"})
	if err != nil {
		t.Fatalf("account: %v", err)
	}
	acct := row["id"].(string)
	g, err := AccountGroupCreate(db, "support", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := AccountGroupAddMember(db, g.ID, acct); err != nil {
		t.Fatalf("add: %v", err)
	}
	if err := AccountGroupRemoveMember(db, g.ID, acct); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if members, _ := AccountGroupMemberIDs(db, g.ID); len(members) != 0 {
		t.Fatalf("after remove the group still has %d members", len(members))
	}
	// Removing again is a no-op, not an error.
	if err := AccountGroupRemoveMember(db, g.ID, acct); err != nil {
		t.Fatalf("second remove: %v", err)
	}

	if err := AccountGroupAddMember(db, g.ID, acct); err != nil {
		t.Fatalf("re-add: %v", err)
	}
	members, err := AccountGroupMemberIDs(db, g.ID)
	if err != nil {
		t.Fatalf("members: %v", err)
	}
	if len(members) != 1 || members[0] != acct {
		t.Fatalf("after re-add members = %v, want [%s]", members, acct)
	}

	// And through the replace-all path too, which is what the admin page posts.
	if err := AccountGroupAssignMembers(db, g.ID, []string{acct}); err != nil {
		t.Fatalf("assign again: %v", err)
	}
	if members, _ := AccountGroupMemberIDs(db, g.ID); len(members) != 1 {
		t.Fatalf("replace with the same member produced %d rows, want 1", len(members))
	}
}

// TestAccountGroupDeleteCascadesMembership — a live membership pointing at a
// deleted group would keep that account resolvable by a filter for a group the
// UI no longer offers.
func TestAccountGroupDeleteCascadesMembership(t *testing.T) {
	db, err := Open(t.TempDir() + "/groupdel.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	row, err := GenericInsert(db, "account", map[string]any{"name": "ann", "email": "a@e.com", "api_key": "k"})
	if err != nil {
		t.Fatalf("account: %v", err)
	}
	acct := row["id"].(string)
	g, err := AccountGroupCreate(db, "support", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := AccountGroupAssignMembers(db, g.ID, []string{acct}); err != nil {
		t.Fatalf("assign: %v", err)
	}
	if err := AccountGroupDelete(db, g.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// The union query joins on a live group, so a deleted group resolves to
	// nobody even if a membership row survived.
	union, err := AccountGroupMemberIDsMany(db, []string{g.ID})
	if err != nil {
		t.Fatalf("union: %v", err)
	}
	if len(union) != 0 {
		t.Fatalf("deleted group still resolves to %v", union)
	}
	if groups, _ := AccountGroupsOf(db, acct); len(groups) != 0 {
		t.Fatalf("account still belongs to %d deleted groups", len(groups))
	}
}

// TestAccountGroupEmptyIsNotUnfiltered — resolving no groups yields no members.
// The usage handler turns that into an empty result rather than silently
// dropping the filter and showing the whole instance.
func TestAccountGroupEmptyIsNotUnfiltered(t *testing.T) {
	db, err := Open(t.TempDir() + "/groupempty.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	empty, err := AccountGroupCreate(db, "empty", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	members, err := AccountGroupMemberIDsMany(db, []string{empty.ID})
	if err != nil {
		t.Fatalf("union: %v", err)
	}
	if len(members) != 0 {
		t.Fatalf("empty group resolved to %v, want none", members)
	}
	if members, err := AccountGroupMemberIDsMany(db, nil); err != nil || members != nil {
		t.Fatalf("no groups resolved to %v (err %v), want nil", members, err)
	}
}
