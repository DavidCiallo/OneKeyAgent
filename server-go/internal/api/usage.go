package api

import (
	"fmt"
	"sort"
	"time"

	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

const tenMin = 10 * 60 * 1000
const dayMs = 86_400_000

// ─────────────────────────── usage list (60m buckets) ───────────────────────────

func (a *App) usageList(c *httpx.Ctx) (any, error) {
	if c.Auth == "" {
		return nil, fmt.Errorf("Authorization failed")
	}
	account, err := service.AccountByAuth(a.DB, c.Auth)
	if err != nil {
		return nil, err
	}
	page := c.Int("page")
	if page == 0 {
		page = 1
	}
	var accountFilter, modelFilter *string
	isAdmin := account.IsAdmin != 0
	if f := c.Obj("filter"); f != nil {
		if aid, ok := f["account_id"].(string); ok && aid != "" && isAdmin {
			accountFilter = &aid
		}
		if mal, ok := f["model_alias"].(string); ok && mal != "" {
			modelFilter = &mal
		}
	}
	if !isAdmin {
		aid := account.ID
		accountFilter = &aid
	}
	since := store.Now() - 30*dayMs
	list, total, err := store.BucketFindPage(a.DB, page, accountFilter, modelFilter, since)
	if err != nil {
		return nil, err
	}

	accountNames := map[string]string{}
	providerNames := map[string]string{}
	dtos := make([]map[string]any, 0, len(list))
	for _, b := range list {
		if _, ok := accountNames[b.AccountID]; !ok {
			accountNames[b.AccountID] = accountDisplayName(a, b.AccountID)
		}
		if b.ProviderID != "" {
			if _, ok := providerNames[b.ProviderID]; !ok {
				if p, err := store.ProviderFindOne(a.DB, b.ProviderID, true); err == nil && p != nil {
					providerNames[b.ProviderID] = p.Name
				} else {
					providerNames[b.ProviderID] = b.ProviderID
				}
			}
		}
		dto := map[string]any{
			"id": b.ID, "account_id": b.AccountID, "accountName": accountNames[b.AccountID],
			"model_alias": b.ModelAlias,
			"input_tokens": b.InputTokens, "cached_input_tokens": b.CachedInputTokens,
			"output_tokens": b.OutputTokens, "cost": store.Round6(b.Cost),
			"create_time": b.CreateTime,
		}
		if b.ProviderID != "" {
			dto["provider_id"] = b.ProviderID
			dto["providerName"] = providerNames[b.ProviderID]
		}
		dtos = append(dtos, dto)
	}
	return map[string]any{"list": dtos, "total": total}, nil
}

func accountDisplayName(a *App, id string) string {
	acc, err := store.AccountByIDIgnoreDelete(a.DB, id)
	if err != nil || acc == nil {
		return id
	}
	return fmt.Sprintf("%s (%s)", acc.Name, acc.Email)
}

// ─────────────────────────── stats (today / 24h / 7d) ───────────────────────────

type statsPeriod struct {
	Total   float64          `json:"total"`
	Amounts []map[string]any `json:"amounts"`
}

func mapToPeriod(m map[int64]float64) statsPeriod {
	keys := make([]int64, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	amounts := []map[string]any{}
	cumulative := 0.0
	for _, ts := range keys {
		cumulative += m[ts]
		amount := store.Round6(cumulative/1_000_000*100) / 100
		if len(amounts) == 0 || amounts[len(amounts)-1]["amount"] != amount {
			amounts = append(amounts, map[string]any{"ts": ts, "amount": amount})
		}
	}
	total := 0.0
	if len(amounts) > 0 {
		total = amounts[len(amounts)-1]["amount"].(float64)
	}
	return statsPeriod{Total: total, Amounts: amounts}
}

func bucketSlots(granularity string) int {
	switch granularity {
	case "minute", "1m":
		return 1
	case "hour", "60m":
		return 6
	case "1d":
		return 144
	default:
		return 1
	}
}

func (a *App) usageStats(c *httpx.Ctx) (any, error) {
	if c.Auth == "" {
		return nil, fmt.Errorf("Authorization failed")
	}
	account, err := service.AccountByAuth(a.DB, c.Auth)
	if err != nil {
		return nil, err
	}
	var accountFilter *string
	if account.IsAdmin == 0 {
		aid := account.ID
		accountFilter = &aid
	}
	var modelFilter *string
	if m := c.Str("model_alias"); m != "" {
		modelFilter = &m
	}
	today, last24h, week, err := computeStats(a, modelFilter, accountFilter)
	if err != nil {
		return nil, err
	}
	return map[string]any{"today": today, "last24h": last24h, "last7Days": week}, nil
}

func computeStats(a *App, modelFilter, accountFilter *string) (statsPeriod, statsPeriod, statsPeriod, error) {
	now := store.Now()
	todayStart := store.LocalMidnight(now)
	last24hStart := store.TenMinuteSlot(now - dayMs)

	todayMap := map[int64]float64{}
	last24hMap := map[int64]float64{}
	for t := todayStart; t < now; t += tenMin {
		todayMap[t] = 0
	}
	for t := last24hStart; t < now; t += tenMin {
		last24hMap[t] = 0
	}

	gran := "1m"
	_, err := store.BucketEach(a.DB, store.BucketFilter{
		Granularity:   &gran,
		BucketTimeGte: &last24hStart,
		AccountID:     accountFilter,
		ModelAlias:    modelFilter,
	}, func(b *store.UsageBucket) bool {
		tokens := float64(b.InputTokens + b.OutputTokens)
		slot := store.TenMinuteSlot(b.BucketTime)
		if b.BucketTime >= todayStart {
			if _, ok := todayMap[slot]; ok {
				todayMap[slot] += tokens
			}
		}
		if _, ok := last24hMap[slot]; ok {
			last24hMap[slot] += tokens
		}
		return true
	})
	if err != nil {
		return statsPeriod{}, statsPeriod{}, statsPeriod{}, err
	}

	// 1d buckets spread across the day's 10-min slots (weekly overview)
	gran1d := "1d"
	gte := now - 7*dayMs
	weekMap := map[int64]float64{}
	_, err = store.BucketEach(a.DB, store.BucketFilter{
		Granularity:   &gran1d,
		BucketTimeGte: &gte,
		AccountID:     accountFilter,
		ModelAlias:    modelFilter,
	}, func(b *store.UsageBucket) bool {
		perSlot := float64(b.InputTokens+b.OutputTokens) / float64(bucketSlots("1d"))
		for i := 0; i < 144; i++ {
			weekMap[b.BucketTime+int64(i)*tenMin] += perSlot
		}
		return true
	})
	if err != nil {
		return statsPeriod{}, statsPeriod{}, statsPeriod{}, err
	}
	return mapToPeriod(todayMap), mapToPeriod(last24hMap), mapToPeriod(weekMap), nil
}

// statsBatch — all aliases at once (single pass per granularity).
func (a *App) usageStatsBatch(c *httpx.Ctx) (any, error) {
	if c.Auth == "" {
		return nil, fmt.Errorf("Authorization failed")
	}
	account, err := service.AccountByAuth(a.DB, c.Auth)
	if err != nil {
		return nil, err
	}
	var accountFilter *string
	if account.IsAdmin == 0 {
		aid := account.ID
		accountFilter = &aid
	}
	var aliases []string
	for _, av := range c.Arr("model_aliases") {
		if s, ok := av.(string); ok {
			aliases = append(aliases, s)
		}
	}
	now := store.Now()
	todayStart := store.LocalMidnight(now)
	last24hStart := store.TenMinuteSlot(now - dayMs)

	type aliasMaps struct {
		today, last24h, week map[int64]float64
	}
	mapsByAlias := map[string]*aliasMaps{}
	for _, al := range aliases {
		tm := map[int64]float64{}
		lm := map[int64]float64{}
		for t := todayStart; t < now; t += tenMin {
			tm[t] = 0
		}
		for t := last24hStart; t < now; t += tenMin {
			lm[t] = 0
		}
		mapsByAlias[al] = &aliasMaps{today: tm, last24h: lm, week: map[int64]float64{}}
	}

	gran := "1m"
	_, err = store.BucketEach(a.DB, store.BucketFilter{
		Granularity:   &gran,
		BucketTimeGte: &last24hStart,
		AccountID:     accountFilter,
	}, func(b *store.UsageBucket) bool {
		am, ok := mapsByAlias[b.ModelAlias]
		if !ok {
			return true
		}
		tokens := float64(b.InputTokens + b.OutputTokens)
		slot := store.TenMinuteSlot(b.BucketTime)
		if b.BucketTime >= todayStart {
			if _, ok := am.today[slot]; ok {
				am.today[slot] += tokens
			}
		}
		if _, ok := am.last24h[slot]; ok {
			am.last24h[slot] += tokens
		}
		return true
	})
	if err != nil {
		return nil, err
	}
	gran1d := "1d"
	gte := now - 7*dayMs
	_, err = store.BucketEach(a.DB, store.BucketFilter{
		Granularity:   &gran1d,
		BucketTimeGte: &gte,
		AccountID:     accountFilter,
	}, func(b *store.UsageBucket) bool {
		am, ok := mapsByAlias[b.ModelAlias]
		if !ok {
			return true
		}
		perSlot := float64(b.InputTokens+b.OutputTokens) / float64(bucketSlots("1d"))
		for i := 0; i < 144; i++ {
			am.week[b.BucketTime+int64(i)*tenMin] += perSlot
		}
		return true
	})
	if err != nil {
		return nil, err
	}

	data := map[string]any{}
	for _, al := range aliases {
		am := mapsByAlias[al]
		data[al] = map[string]any{
			"today": mapToPeriod(am.today), "last24h": mapToPeriod(am.last24h), "last7Days": mapToPeriod(am.week),
		}
	}
	return data, nil
}

// ─────────────────────────── sessions ───────────────────────────

type sessionUsage struct {
	ProviderName      string  `json:"providerName"`
	InputTokens       int64   `json:"input_tokens"`
	CachedInputTokens int64   `json:"cached_input_tokens"`
	OutputTokens      int64   `json:"output_tokens"`
	Cost              float64 `json:"cost"`
}

type modelUsage struct {
	ModelAlias        string  `json:"model_alias"`
	InputTokens       int64   `json:"input_tokens"`
	CachedInputTokens int64   `json:"cached_input_tokens"`
	OutputTokens      int64   `json:"output_tokens"`
	Cost              float64 `json:"cost"`
}

type sessionEntry struct {
	AccountID         string         `json:"-"`
	StartTime         int64          `json:"startTime"`
	EndTime           int64          `json:"endTime"`
	ModelAliases      []string       `json:"model_aliases"`
	RequestCount      int64          `json:"requestCount"`
	InputTokens       int64          `json:"input_tokens"`
	CachedInputTokens int64          `json:"cached_input_tokens"`
	OutputTokens      int64          `json:"output_tokens"`
	Cost              float64        `json:"cost"`
	ProviderUsage     []sessionUsage `json:"providerUsage"`
	ModelUsage        []modelUsage   `json:"modelUsage"`
	WindowLabel       string         `json:"windowLabel"`
	AccountName       string         `json:"accountName,omitempty"`
}

func selectGranularity(gapMinutes int, since int64) string {
	if gapMinutes <= 5 {
		return "1m"
	}
	rangeDays := float64(store.Now()-since) / float64(dayMs)
	if rangeDays <= 1 {
		return "1m"
	}
	if rangeDays <= 90 {
		return "60m"
	}
	return "1d"
}

// window accumulator (WinAcc in usage.service.ts)
type winAcc struct {
	in, cached, out, cost, reqs int64
	costF                       float64
	providers                   map[string]*sessionUsage
	models                      map[string]*modelUsage
	modelAliases                map[string]bool
}

func (a *winAcc) add(b *store.UsageBucket) {
	a.in += b.InputTokens
	a.cached += b.CachedInputTokens
	a.out += b.OutputTokens
	a.costF += b.Cost
	a.reqs += b.RequestCount
	a.modelAliases[b.ModelAlias] = true
	pkey := b.ProviderID
	if pkey == "" {
		pkey = "unknown"
	}
	p, ok := a.providers[pkey]
	if !ok {
		p = &sessionUsage{ProviderName: pkey}
		a.providers[pkey] = p
	}
	p.InputTokens += b.InputTokens
	p.CachedInputTokens += b.CachedInputTokens
	p.OutputTokens += b.OutputTokens
	p.Cost += b.Cost
	mkey := b.ModelAlias
	if mkey == "" {
		mkey = "default"
	}
	m, ok := a.models[mkey]
	if !ok {
		m = &modelUsage{ModelAlias: mkey}
		a.models[mkey] = m
	}
	m.InputTokens += b.InputTokens
	m.CachedInputTokens += b.CachedInputTokens
	m.OutputTokens += b.OutputTokens
	m.Cost += b.Cost
}

func (a *App) usageSessions(c *httpx.Ctx) (any, error) {
	if c.Auth == "" {
		return nil, fmt.Errorf("Authorization failed")
	}
	account, err := service.AccountByAuth(a.DB, c.Auth)
	if err != nil {
		return nil, err
	}
	isAdmin := account.IsAdmin != 0

	gapMinutes := int(c.Int("gapMinutes"))
	if gapMinutes == 0 {
		gapMinutes = 30
	}
	now := store.Now()
	effectiveSince := now - 7*dayMs
	if s := c.Int("since"); s > 0 {
		effectiveSince = s
	}
	gapMs := int64(gapMinutes) * 60 * 1000
	granularity := selectGranularity(gapMinutes, effectiveSince)

	var accountSet map[string]bool
	var accountFilter *string
	if !isAdmin {
		accountSet = map[string]bool{account.ID: true}
		aid := account.ID
		accountFilter = &aid
	} else if ids := c.Arr("account_ids"); len(ids) > 0 {
		accountSet = map[string]bool{}
		for _, v := range ids {
			if s, ok := v.(string); ok {
				accountSet[s] = true
			}
		}
	}
	modelSet := setFromArr(c.Arr("model_aliases"))
	providerSet := setFromArr(c.Arr("provider_ids"))

	type accSet struct {
		main map[int64]*winAcc
		oneM map[int64]*winAcc
	}
	byAccount := map[string]*accSet{}
	newAcc := func() *winAcc {
		return &winAcc{
			providers:    map[string]*sessionUsage{},
			models:       map[string]*modelUsage{},
			modelAliases: map[string]bool{},
		}
	}

	gran := granularity
	_, err = store.BucketEach(a.DB, store.BucketFilter{
		Granularity:   &gran,
		BucketTimeGte: &effectiveSince,
		AccountID:     accountFilter,
	}, func(b *store.UsageBucket) bool {
		if accountSet != nil && !accountSet[b.AccountID] {
			return true
		}
		if modelSet != nil && !modelSet[b.ModelAlias] {
			return true
		}
		if providerSet != nil && !providerSet[b.ProviderID] {
			return true
		}
		as := byAccount[b.AccountID]
		if as == nil {
			as = &accSet{main: map[int64]*winAcc{}, oneM: map[int64]*winAcc{}}
			byAccount[b.AccountID] = as
		}
		wStart := windowStartOf(b.BucketTime, gapMs)
		main := as.main[wStart]
		if main == nil {
			main = newAcc()
			as.main[wStart] = main
		}
		main.add(b)

		if b.BucketTime >= maxI64(effectiveSince, now-dayMs) {
			wStart1m := windowStartOf(b.BucketTime, 60_000)
			oneM := as.oneM[wStart1m]
			if oneM == nil {
				oneM = newAcc()
				as.oneM[wStart1m] = oneM
			}
			oneM.add(b)
		}
		return true
	})
	if err != nil {
		return nil, err
	}

	empty := map[string]any{
		"list": []any{}, "recentSessions": []any{},
		"totals": map[string]any{
			"totalTokens": 0, "totalInputTokens": 0, "totalCachedInputTokens": 0,
			"totalOutputTokens": 0, "totalCost": 0, "totalRequests": 0,
		},
	}
	if len(byAccount) == 0 {
		return empty, nil
	}

	buildSessions := func(wins map[int64]*winAcc, gap int64) []sessionEntry {
		out := make([]sessionEntry, 0, len(wins))
		for wStart, wa := range wins {
			entry := sessionEntry{
				StartTime: wStart, EndTime: wStart + gap,
				RequestCount: wa.reqs,
				InputTokens: wa.in, CachedInputTokens: wa.cached,
				OutputTokens: wa.out, Cost: store.Round6(wa.costF),
				WindowLabel: windowLabel(wStart, gap),
			}
			for al := range wa.modelAliases {
				entry.ModelAliases = append(entry.ModelAliases, al)
			}
			sort.Strings(entry.ModelAliases)
			for _, pu := range wa.providers {
				pu.Cost = store.Round6(pu.Cost)
				entry.ProviderUsage = append(entry.ProviderUsage, *pu)
			}
			for _, mu := range wa.models {
				mu.Cost = store.Round6(mu.Cost)
				entry.ModelUsage = append(entry.ModelUsage, *mu)
			}
			out = append(out, entry)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].StartTime > out[j].StartTime })
		return out
	}

	var totals struct{ tokens, in, cached, out, cost, reqs float64 }
	type sgroup struct {
		accountID   string
		accountName string
		sessions    []sessionEntry
		totalTokens int64
		totalReqs   int64
	}
	var groups []sgroup
	var recentFlat []sessionEntry

	for aid, as := range byAccount {
		sessions := buildSessions(as.main, gapMs)
		var groupTokens, groupReqs int64
		for _, s := range sessions {
			totals.tokens += float64(s.InputTokens + s.OutputTokens)
			totals.in += float64(s.InputTokens)
			totals.cached += float64(s.CachedInputTokens)
			totals.out += float64(s.OutputTokens)
			totals.cost += s.Cost
			totals.reqs += float64(s.RequestCount)
			groupTokens += s.InputTokens + s.OutputTokens
			groupReqs += s.RequestCount
		}
		groups = append(groups, sgroup{
			accountID: aid, accountName: accountNameByID(a, aid),
			sessions: sessions, totalTokens: groupTokens, totalReqs: groupReqs,
		})
		for _, s := range buildSessions(as.oneM, 60_000) {
			s.AccountID = aid
			recentFlat = append(recentFlat, s)
		}
	}

	sort.Slice(groups, func(i, j int) bool {
		maxI, maxJ := int64(0), int64(0)
		if len(groups[i].sessions) > 0 {
			maxI = groups[i].sessions[0].StartTime
		}
		if len(groups[j].sessions) > 0 {
			maxJ = groups[j].sessions[0].StartTime
		}
		return maxI > maxJ
	})

	// keep top 200 sessions across all groups
	type span struct {
		gi, si int
		st     int64
	}
	var spans []span
	for gi, g := range groups {
		for si, s := range g.sessions {
			spans = append(spans, span{gi, si, s.StartTime})
		}
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].st > spans[j].st })
	keep := map[string]bool{}
	for i, sp := range spans {
		if i >= 200 {
			break
		}
		keep[fmt.Sprintf("%d:%d", sp.gi, sp.si)] = true
	}
	for gi := range groups {
		filtered := make([]sessionEntry, 0, len(groups[gi].sessions))
		for si, s := range groups[gi].sessions {
			if keep[fmt.Sprintf("%d:%d", gi, si)] {
				filtered = append(filtered, s)
			}
		}
		groups[gi].sessions = filtered
	}

	// filter sessions whose model was deleted + resolve provider names
	activeModels, err := store.ModelAllActive(a.DB)
	if err != nil {
		return nil, err
	}
	activeAliases := map[string]bool{}
	for _, m := range activeModels {
		activeAliases[m.Alias] = true
	}
	activeProviders, err := store.ProviderAllIgnoreDelete(a.DB)
	if err != nil {
		return nil, err
	}
	providerNameMap := map[string]string{}
	activeProviderIDs := map[string]bool{}
	for _, p := range activeProviders {
		providerNameMap[p.ID] = p.Name
		if p.DeleteTime == nil {
			activeProviderIDs[p.ID] = true
		}
	}

	outGroups := []map[string]any{}
	for _, g := range groups {
		sessionsOut := []sessionEntry{}
		for _, s := range g.sessions {
			alive := false
			for _, ma := range s.ModelAliases {
				if activeAliases[ma] {
					alive = true
					break
				}
			}
			if !alive {
				continue
			}
			if accountSet != nil && !isAdmin {
				// scoped view: model usage stands in for provider usage
				pu := make([]sessionUsage, 0, len(s.ModelUsage))
				for _, mu := range s.ModelUsage {
					pu = append(pu, sessionUsage{
						ProviderName: mu.ModelAlias,
						InputTokens: mu.InputTokens, CachedInputTokens: mu.CachedInputTokens,
						OutputTokens: mu.OutputTokens, Cost: mu.Cost,
					})
				}
				s.ProviderUsage = pu
			} else {
				kept := make([]sessionUsage, 0, len(s.ProviderUsage))
				for _, p := range s.ProviderUsage {
					if activeProviderIDs[p.ProviderName] {
						if name, ok := providerNameMap[p.ProviderName]; ok {
							p.ProviderName = name
						}
						kept = append(kept, p)
					}
				}
				s.ProviderUsage = kept
			}
			s.AccountName = g.accountName
			sessionsOut = append(sessionsOut, s)
		}
		if len(sessionsOut) == 0 {
			continue
		}
		outGroups = append(outGroups, map[string]any{
			"account_id": g.accountID, "accountName": g.accountName,
			"sessions": sessionsOut, "totalTokens": g.totalTokens, "totalRequests": g.totalReqs,
		})
	}

	sort.Slice(recentFlat, func(i, j int) bool { return recentFlat[i].StartTime > recentFlat[j].StartTime })
	if len(recentFlat) > 20 {
		recentFlat = recentFlat[:20]
	}
	for i := range recentFlat {
		recentFlat[i].AccountName = accountNameByID(a, recentFlat[i].AccountID)
	}

	return map[string]any{
		"list": outGroups, "recentSessions": recentFlat,
		"totals": map[string]any{
			"totalTokens": int64(totals.tokens), "totalInputTokens": int64(totals.in),
			"totalCachedInputTokens": int64(totals.cached), "totalOutputTokens": int64(totals.out),
			"totalCost": store.Round6(totals.cost), "totalRequests": int64(totals.reqs),
		},
	}, nil
}

func accountNameByID(a *App, id string) string {
	acc, err := store.AccountByIDIgnoreDelete(a.DB, id)
	if err != nil || acc == nil {
		return "--"
	}
	return acc.Name
}

func setFromArr(arr []any) map[string]bool {
	if len(arr) == 0 {
		return nil
	}
	out := map[string]bool{}
	for _, v := range arr {
		if s, ok := v.(string); ok {
			out[s] = true
		}
	}
	return out
}

func maxI64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func windowStartOf(ts, gapMs int64) int64 {
	localMid := store.LocalMidnight(ts)
	offset := ts - localMid
	return localMid + (offset/gapMs)*gapMs
}

func windowLabel(ts, gapMs int64) string {
	d := time.UnixMilli(ts).In(time.Local)
	end := time.UnixMilli(ts + gapMs).In(time.Local)
	mm, dd := fmt.Sprintf("%02d", int(d.Month())), fmt.Sprintf("%02d", d.Day())
	switch {
	case gapMs >= 86_400_000:
		return fmt.Sprintf("%s/%s", mm, dd)
	case gapMs >= 3_600_000:
		return fmt.Sprintf("%s/%s %02d:00-%02d:00", mm, dd, d.Hour(), end.Hour())
	default:
		return fmt.Sprintf("%s/%s %02d:%02d-%02d:%02d", mm, dd, d.Hour(), d.Minute(), end.Hour(), end.Minute())
	}
}
