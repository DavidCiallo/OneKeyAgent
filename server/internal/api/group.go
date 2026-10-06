package api

import (
	"fmt"

	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

// ─────────────────────────── account groups ───────────────────────────
//
// Groups are an organisational label used by the usage filter; see the note at
// the top of store/group.go on why they are not the `role` table.

func (a *App) groupList(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	list, err := store.AccountGroupList(a.DB)
	if err != nil {
		return nil, err
	}
	dtos := make([]map[string]any, 0, len(list))
	for _, g := range list {
		dtos = append(dtos, g.DTO())
	}
	return map[string]any{"list": dtos, "total": len(dtos)}, nil
}

// groupDetail — the group plus its member account ids, which is what the admin
// page's checkbox list is seeded from.
func (a *App) groupDetail(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	if id == "" {
		return nil, fmt.Errorf("miss params")
	}
	g, err := store.AccountGroupFindOne(a.DB, id)
	if err != nil {
		return nil, err
	}
	members, err := store.AccountGroupMemberIDs(a.DB, id)
	if err != nil {
		return nil, err
	}
	dto := g.DTO()
	return map[string]any{"group": dto, "member_ids": members}, nil
}

func (a *App) groupCreate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	g, err := store.AccountGroupCreate(a.DB, c.Str("name"), c.Str("remark"))
	if err != nil {
		return nil, err
	}
	return map[string]any{"group": g.DTO()}, nil
}

func (a *App) groupUpdate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	if id == "" {
		return nil, fmt.Errorf("miss params")
	}
	g, err := store.AccountGroupUpdate(a.DB, id, c.Str("name"), c.Str("remark"))
	if err != nil {
		return nil, err
	}
	return map[string]any{"group": g.DTO()}, nil
}

func (a *App) groupDelete(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	if id == "" {
		return nil, fmt.Errorf("Delete wrong")
	}
	if err := store.AccountGroupDelete(a.DB, id); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

// groupAssignMembers — replace a group's membership. The body carries
// account_ids; an absent key is treated as "no members" only when it is present
// but empty, so a malformed request cannot silently clear a group.
func (a *App) groupAssignMembers(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	if id == "" {
		return nil, fmt.Errorf("miss params")
	}
	raw, present := c.M["account_ids"]
	if !present {
		return nil, fmt.Errorf("miss params")
	}
	if raw == nil {
		raw = []any{}
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("account_ids must be an array")
	}
	ids := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok && s != "" {
			ids = append(ids, s)
		}
	}
	if err := store.AccountGroupAssignMembers(a.DB, id, ids); err != nil {
		return nil, err
	}
	return map[string]any{"count": len(ids)}, nil
}

// groupAccountGroups — the groups one account belongs to, for the account page.
func (a *App) groupAccountGroups(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	accountID := c.Str("account_id")
	if accountID == "" {
		return nil, fmt.Errorf("miss params")
	}
	groups, err := store.AccountGroupsOf(a.DB, accountID)
	if err != nil {
		return nil, err
	}
	dtos := make([]map[string]any, 0, len(groups))
	for _, g := range groups {
		dtos = append(dtos, g.DTO())
	}
	return map[string]any{"groups": dtos}, nil
}

// groupSetAccountGroups — replace which groups one account is in. The account
// page edits membership from the account's side, so this is the mirror of
// groupAssignMembers.
func (a *App) groupSetAccountGroups(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	accountID := c.Str("account_id")
	if accountID == "" {
		return nil, fmt.Errorf("miss params")
	}
	raw, present := c.M["group_ids"]
	if !present {
		return nil, fmt.Errorf("miss params")
	}
	if raw == nil {
		raw = []any{}
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("group_ids must be an array")
	}
	want := map[string]bool{}
	for _, v := range arr {
		if s, ok := v.(string); ok && s != "" {
			want[s] = true
		}
	}
	all, err := store.AccountGroupList(a.DB)
	if err != nil {
		return nil, err
	}
	for _, g := range all {
		if want[g.ID] {
			if err := store.AccountGroupAddMember(a.DB, g.ID, accountID); err != nil {
				return nil, err
			}
			continue
		}
		if err := store.AccountGroupRemoveMember(a.DB, g.ID, accountID); err != nil {
			return nil, err
		}
	}
	return map[string]any{"count": len(want)}, nil
}
