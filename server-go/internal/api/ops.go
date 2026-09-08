package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"onekey/server/internal/httpx"
	"onekey/server/internal/store"
)

// ─────────────────────────── task controller ───────────────────────────

func (a *App) taskPoll(c *httpx.Ctx) (any, error) {
	account, err := store.AccountFindByApiKey(a.DB, c.Auth)
	if err == store.ErrNotFound || account == nil {
		return nil, fmt.Errorf("Authorization failed")
	}
	if err != nil {
		return nil, err
	}
	// long-poll: up to 50 × 1s like task.service.ts pollByAccount
	for i := 0; i < 50; i++ {
		task, err := store.TaskFindFirst(a.DB, account.ID, "pending")
		if err != nil && err != store.ErrNotFound {
			return nil, err
		}
		if task == nil {
			task, err = store.TaskFindFirst(a.DB, account.ID, "processing")
			if err != nil && err != store.ErrNotFound {
				return nil, err
			}
		}
		if task != nil {
			if err := store.GenericUpdateByID(a.DB, "task", task.ID, map[string]any{"status": "processing"}); err != nil {
				return nil, err
			}
			task.Status = "processing"
			return map[string]any{"task": task.DTO()}, nil
		}
		time.Sleep(1 * time.Second)
	}
	return map[string]any{"task": nil}, nil
}

func (a *App) taskReceive(c *httpx.Ctx) (any, error) {
	task := c.Obj("task")
	if task == nil {
		return nil, fmt.Errorf("miss params")
	}
	chatID, _ := task["tg_chat_id"].(string)
	account, err := store.AccountFindByTgChat(a.DB, chatID)
	if err == store.ErrNotFound || account == nil {
		return nil, fmt.Errorf("no account bound to this tg_chat_id")
	}
	if err != nil {
		return nil, err
	}
	text, _ := task["text"].(string)
	stored, err := store.GenericInsert(a.DB, "task", map[string]any{
		"account_id": account.ID, "task_text": text, "status": "pending",
	})
	if err != nil {
		return nil, err
	}
	full, err := store.TaskFindOne(a.DB, stored["id"].(string))
	if err != nil {
		return nil, err
	}
	return map[string]any{"task": full.DTO()}, nil
}

func (a *App) taskComplete(c *httpx.Ctx) (any, error) {
	id := c.Str("id")
	task := c.Obj("task")
	if task == nil {
		return nil, fmt.Errorf("miss params")
	}
	status, _ := task["status"].(string)
	result, _ := task["result"].(string)
	target, err := store.TaskFindOne(a.DB, id)
	if err == store.ErrNotFound || target == nil {
		return nil, fmt.Errorf("task not found")
	}
	if err != nil {
		return nil, err
	}
	account, err := store.AccountFindOne(a.DB, target.AccountID)
	if err == nil && account != nil && account.TgChatID != nil && *account.TgChatID != "" {
		text := result
		if text == "" {
			text = "No reply and ask again maybe..."
		}
		go telegramSend(a, *account.TgChatID, text)
	}
	if err := store.GenericUpdateByID(a.DB, "task", id, map[string]any{"status": status}); err != nil {
		return nil, err
	}
	updated, err := store.TaskFindOne(a.DB, id)
	if err != nil {
		return nil, err
	}
	return map[string]any{"task": updated.DTO()}, nil
}

func (a *App) taskMessage(c *httpx.Ctx) (any, error) {
	id := c.Str("id")
	text := c.Str("text")
	target, err := store.TaskFindOne(a.DB, id)
	if err == store.ErrNotFound || target == nil {
		return nil, fmt.Errorf("task not found or no tg bound")
	}
	if err != nil {
		return nil, err
	}
	account, err := store.AccountFindOne(a.DB, target.AccountID)
	if err == store.ErrNotFound || account == nil || account.TgChatID == nil || *account.TgChatID == "" {
		return nil, fmt.Errorf("task not found or no tg bound")
	}
	if err != nil {
		return nil, err
	}
	if messageID := telegramSend(a, *account.TgChatID, text); messageID != "" {
		return map[string]any{}, nil
	}
	return nil, fmt.Errorf("task not found or no tg bound")
}

// ─────────────────────────── telegram controller/service ───────────────────────────

type tgUpdate struct {
	CallbackQuery *struct {
		ID string `json:"id"`
		Data string `json:"data"`
		Message *tgMessage `json:"message"`
	} `json:"callback_query"`
	Message       *tgMessage `json:"message"`
	EditedMessage *tgMessage `json:"edited_message"`
}

type tgMessage struct {
	Chat struct {
		ID int64 `json:"id"`
	} `json:"chat"`
	Text      string `json:"text"`
	MessageID int64  `json:"message_id"`
}

func (a *App) tgWebhook(c *httpx.Ctx) (any, error) {
	var update tgUpdate
	if err := json.Unmarshal(c.RawBody, &update); err != nil {
		return map[string]any{}, nil
	}
	if update.CallbackQuery != nil && update.CallbackQuery.Message != nil {
		chatID := fmt.Sprintf("%d", update.CallbackQuery.Message.Chat.ID)
		go a.tgHandleMessage(chatID, update.CallbackQuery.Data, 0)
		go tgAnswerCallback(a, update.CallbackQuery.ID)
		return map[string]any{}, nil
	}
	msg := update.Message
	if msg == nil {
		msg = update.EditedMessage
	}
	if msg == nil || msg.Text == "" {
		return map[string]any{}, nil
	}
	chatID := fmt.Sprintf("%d", msg.Chat.ID)
	go a.tgHandleMessage(chatID, msg.Text, msg.MessageID)
	return map[string]any{}, nil
}

func tgAPIBase(a *App) string { return a.Settings.Get("tg_bot_api_base_url") }

func tgPost(a *App, method string, body map[string]any) map[string]any {
	base := tgAPIBase(a)
	if base == "" {
		fmt.Println(time.Now().Format(time.RFC3339), "TG_BOT_API_BASE_URL not configured")
		return nil
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", base+"/"+method, bytes.NewReader(payload))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out
}

func tgAnswerCallback(a *App, callbackID string) {
	tgPost(a, "answerCallbackQuery", map[string]any{"callback_query_id": callbackID})
}

func tgSetReaction(a *App, chatID, messageID, emoji string) {
	tgPost(a, "setMessageReaction", map[string]any{
		"chat_id": chatID, "message_id": messageID,
		"reaction": []any{map[string]any{"type": "emoji", "emoji": emoji}},
	})
}

func tgDeleteMessage(a *App, chatID, messageID string) {
	tgPost(a, "deleteMessage", map[string]any{"chat_id": chatID, "message_id": messageID})
}

func isJSONArray(s string) bool {
	trimmed := strings.TrimSpace(s)
	if !strings.HasPrefix(trimmed, "[") {
		return false
	}
	var arr []any
	return json.Unmarshal([]byte(trimmed), &arr) == nil
}

// telegramSend — sendMessage with the TS retry/escape/inline-keyboard logic.
func telegramSend(a *App, chatID, text string) string {
	base := tgAPIBase(a)
	if base == "" {
		fmt.Println(time.Now().Format(time.RFC3339), "TG_BOT_API_BASE_URL not configured")
		return ""
	}
	jsonPayload := isJSONArray(text)
	safeText := text
	if !jsonPayload {
		r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
		safeText = r.Replace(text)
	}
	body := map[string]any{"chat_id": chatID, "text": safeText, "parse_mode": "HTML"}
	var keyboard []any
	if jsonPayload {
		_ = json.Unmarshal([]byte(text), &keyboard)
		body["text"] = "<pre>Parsed</pre>"
		body["reply_markup"] = map[string]any{"inline_keyboard": keyboard}
	}

	var messageID string
	for i := 0; i < 3; i++ {
		if out := tgPost(a, "sendMessage", body); out != nil {
			if id := extractMessageID(out); id != "" {
				messageID = id
				break
			}
		}
		time.Sleep(1 * time.Second)
	}
	if messageID == "" {
		delete(body, "parse_mode")
		for i := 0; i < 3; i++ {
			if out := tgPost(a, "sendMessage", body); out != nil {
				if id := extractMessageID(out); id != "" {
					messageID = id
					break
				}
			}
			time.Sleep(1 * time.Second)
		}
	}
	if messageID == "" {
		for i := 0; i < 3; i++ {
			fallback := map[string]any{"chat_id": chatID, "text": "Completed task but failed to send message"}
			if out := tgPost(a, "sendMessage", fallback); out != nil {
				if id := extractMessageID(out); id != "" {
					messageID = id
					break
				}
			}
			time.Sleep(1 * time.Second)
		}
	}
	return messageID
}

func extractMessageID(out map[string]any) string {
	result := out["result"]
	if m, ok := result.(map[string]any); ok {
		switch id := m["message_id"].(type) {
		case float64:
			return fmt.Sprintf("%d", int64(id))
		case string:
			return id
		}
	}
	return ""
}

func (a *App) tgHandleMessage(chatID, text string, messageID int64) {
	account, err := store.AccountFindByTgChat(a.DB, chatID)
	if err == store.ErrNotFound || account == nil {
		if strings.HasPrefix(text, "/auth") {
			a.tgHandleAuth(chatID, text)
		} else {
			telegramSend(a, chatID, "Please use /auth [api_key] first")
		}
		return
	}
	if err != nil {
		return
	}
	if strings.HasPrefix(text, "/") {
		a.tgHandleCommand(account, chatID, text)
		return
	}
	a.tgHandleTaskCreate(account, chatID, text, messageID)
}

func (a *App) tgHandleAuth(chatID, text string) {
	parts := strings.Fields(strings.TrimSpace(text))
	apiKey := strings.Join(parts[1:], " ")
	if apiKey == "" {
		telegramSend(a, chatID, "Usage: /auth [api_key]")
		return
	}
	account, err := store.AccountFindByApiKey(a.DB, apiKey)
	if err == store.ErrNotFound || account == nil {
		telegramSend(a, chatID, "Authentication failed, invalid API Key")
		return
	}
	if err != nil {
		return
	}
	if err := store.GenericUpdateByID(a.DB, "account", account.ID, map[string]any{"tg_chat_id": chatID}); err != nil {
		return
	}
	telegramSend(a, chatID, fmt.Sprintf("Bound successfully!\nAccount: %s\nYou can set a working directory and start publishing tasks", account.Name))
}

func (a *App) tgHandleCommand(account *store.Account, chatID, text string) {
	parts := strings.Fields(strings.TrimSpace(text))
	command := strings.ToLower(parts[0])
	args := strings.Join(parts[1:], " ")

	switch command {
	case "/help":
		telegramSend(a, chatID, strings.Join([]string{
			"Available commands:",
			"/status - Show current account, folder and task status",
			"/ls - List contents of the system target folder",
			"/help - Show this help message",
		}, "\n"))
	case "/status":
		currentTask, folder := "", ""
		procTask, err := store.TaskFindFirst(a.DB, account.ID, "processing")
		if err == nil && procTask != nil {
			currentTask = truncateRunes(procTask.TaskText, 10)
			if procTask.Folder != nil {
				folder = *procTask.Folder
			}
		} else if tasks, err := store.TaskAllByAccount(a.DB, account.ID); err == nil {
			sort.Slice(tasks, func(i, j int) bool { return tasks[i].CreateTime > tasks[j].CreateTime })
			if len(tasks) > 0 {
				currentTask = truncateRunes(tasks[0].TaskText, 10)
				if tasks[0].Folder != nil {
					folder = *tasks[0].Folder
				}
			}
		}
		msg := fmt.Sprintf("Account: %s\nFolder: %s\nTask: %s", account.Name, orNone(folder), orNone(currentTask))
		telegramSend(a, chatID, msg)
	case "/ls":
		folder := ""
		if tasks, err := store.TaskAllByAccount(a.DB, account.ID); err == nil {
			sort.Slice(tasks, func(i, j int) bool { return tasks[i].CreateTime > tasks[j].CreateTime })
			if len(tasks) > 0 && tasks[0].Folder != nil {
				folder = *tasks[0].Folder
			}
		}
		var folderPtr *string
		if folder != "" {
			folderPtr = &folder
		}
		_, _ = store.GenericInsert(a.DB, "task", map[string]any{
			"account_id": account.ID, "task_text": "ls " + args, "status": "pending", "folder": folderPtr,
		})
	case "/fd":
		if args == "" {
			telegramSend(a, chatID, "Usage: Please use /ls to set a directory")
			return
		}
		folder := args
		stored, err := store.GenericInsert(a.DB, "task", map[string]any{
			"account_id": account.ID, "task_text": "fd " + args, "folder": &folder, "status": "pending",
		})
		if err != nil {
			return
		}
		telegramSend(a, chatID, fmt.Sprintf("Switch directory task created\nID: %s\nTarget: %s", stored["id"], args))
	default:
		telegramSend(a, chatID, fmt.Sprintf("Unknown command: %s", command))
	}
}

func (a *App) tgHandleTaskCreate(account *store.Account, chatID, text string, messageID int64) {
	folder := ""
	if tasks, err := store.TaskAllByAccount(a.DB, account.ID); err == nil {
		sort.Slice(tasks, func(i, j int) bool { return tasks[i].CreateTime > tasks[j].CreateTime })
		if len(tasks) > 0 && tasks[0].Folder != nil {
			folder = *tasks[0].Folder
		}
	}
	if folder == "" {
		telegramSend(a, chatID, "Please use /ls to set a directory")
		return
	}
	var folderPtr *string
	if folder != "" {
		folderPtr = &folder
	}
	if _, err := store.GenericInsert(a.DB, "task", map[string]any{
		"account_id": account.ID, "task_text": text, "folder": folderPtr, "status": "pending",
	}); err != nil {
		return
	}
	if messageID > 0 {
		tgSetReaction(a, chatID, fmt.Sprintf("%d", messageID), "👀")
	}
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func orNone(s string) string {
	if s == "" {
		return "none"
	}
	return s
}

