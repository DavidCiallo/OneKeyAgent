package api

import (
	"encoding/json"
	"fmt"
	"strings"

	"onekey/server/internal/ai"
	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

// aiAuth — resolve the sk- key to an account (ai.auth.ts).
func (a *App) aiAuth(c *httpx.Ctx) (string, error) {
	account, err := store.AccountFindByApiKey(a.DB, c.Auth)
	if err == store.ErrNotFound || account == nil {
		return "", fmt.Errorf("Invalid API Key")
	}
	if err != nil {
		return "", err
	}
	return account.ID, nil
}

func (a *App) aiChatCompletions(c *httpx.Ctx) (any, error) {
	accountID, err := a.aiAuth(c)
	if err != nil {
		return nil, err
	}
	body := c.M
	if stream, _ := body["stream"].(bool); stream {
		pipeline, err := a.AI.StartStreamAt(body, accountID, "/api/chat/completions")
		if err != nil {
			return nil, err
		}
		ai.ServeSSE(c.W, pipeline.Reader)
		return streamReply{}, nil
	}
	result, err := a.AI.ChatCompletionsAt(body, accountID, "/api/chat/completions")
	if err != nil {
		return nil, err
	}
	return raw(result), nil
}

func (a *App) aiCompletions(c *httpx.Ctx) (any, error) {
	accountID, err := a.aiAuth(c)
	if err != nil {
		return nil, err
	}
	body := c.M
	if stream, _ := body["stream"].(bool); stream {
		pipeline, err := a.AI.StartStreamAt(body, accountID, "/api/completions")
		if err != nil {
			return nil, err
		}
		ai.ServeSSE(c.W, pipeline.Reader)
		return streamReply{}, nil
	}
	// TS quirk kept: /api/completions returns the chat.completion shape.
	result, err := a.AI.ChatCompletionsAt(body, accountID, "/api/completions")
	if err != nil {
		return nil, err
	}
	return raw(result), nil
}

func (a *App) aiModels(c *httpx.Ctx) (any, error) {
	auth := c.Auth
	accountID := ""
	if auth != "" {
		if strings.HasPrefix(auth, "sk-") && len(auth) == 39 {
			if account, err := store.AccountFindByApiKey(a.DB, auth); err == nil && account != nil {
				accountID = account.ID
			}
		} else if email, ok := service.GetIdentifyByVerify(auth); ok {
			if account, err := store.AccountFindByEmail(a.DB, email, false); err == nil && account != nil {
				accountID = account.ID
			}
		}
	}
	result, err := a.AI.ListModels(accountID)
	if err != nil {
		return nil, err
	}
	return raw(result), nil
}

// antErrorStream — the SSE error payload v1messages emits on setup failure.
func antErrorStream(message string) string {
	evt, _ := json.Marshal(map[string]any{
		"type":  "error",
		"error": map[string]any{"type": "api_error", "message": message},
	})
	return fmt.Sprintf("event: error\ndata: %s\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n", evt)
}

func (a *App) aiV1Messages(c *httpx.Ctx) (any, error) {
	accountID, err := a.aiAuth(c)
	if err != nil {
		return nil, err
	}
	body := c.M
	if stream, _ := body["stream"].(bool); stream {
		reader, err := a.AI.AntMessagesStream(body, accountID)
		if err != nil {
			ai.ServeSSE(c.W, strings.NewReader(antErrorStream(err.Error())))
			return streamReply{}, nil
		}
		ai.ServeSSE(c.W, reader)
		return streamReply{}, nil
	}
	result, err := a.AI.AntMessages(body, accountID)
	if err != nil {
		return nil, err
	}
	return raw(result), nil
}
