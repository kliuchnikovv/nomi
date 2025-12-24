package jules

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const DefaultBaseURL = "https://jules.googleapis.com/v1alpha"

type Client struct {
	apiKey  string
	baseURL string
	client  *http.Client
}

func NewClient(apiKey string) *Client {
	return &Client{
		apiKey:  apiKey,
		baseURL: DefaultBaseURL,
		client:  &http.Client{},
	}
}

type Source struct {
	Name       string `json:"name"`
	ID         string `json:"id"`
	GithubRepo *struct {
		Owner string `json:"owner"`
		Repo  string `json:"repo"`
	} `json:"githubRepo,omitempty"`
}

type ListSourcesResponse struct {
	Sources       []Source `json:"sources"`
	NextPageToken string   `json:"nextPageToken,omitempty"`
}

type Session struct {
	Name          string `json:"name"`
	ID            string `json:"id"`
	Title         string `json:"title"`
	Prompt        string `json:"prompt"`
	SourceContext struct {
		Source            string `json:"source"`
		GithubRepoContext struct {
			StartingBranch string `json:"startingBranch"`
		} `json:"githubRepoContext"`
	} `json:"sourceContext"`
}

type ListSessionsResponse struct {
	Sessions      []Session `json:"sessions"`
	NextPageToken string    `json:"nextPageToken,omitempty"`
}

type Activity struct {
	Name            string                 `json:"name"`
	ID              string                 `json:"id"`
	CreateTime      string                 `json:"createTime"`
	Originator      string                 `json:"originator"` // "agent" or "user"
	ProgressUpdated map[string]interface{} `json:"progressUpdated,omitempty"`
	PlanGenerated   map[string]interface{} `json:"planGenerated,omitempty"`
	Artifacts       []interface{}          `json:"artifacts,omitempty"`
}

type ListActivitiesResponse struct {
	Activities    []Activity `json:"activities"`
	NextPageToken string     `json:"nextPageToken,omitempty"`
}

func (c *Client) ListSources(ctx context.Context) ([]Source, error) {
	var resp ListSourcesResponse
	if err := c.doRequest(ctx, "GET", "/sources", nil, nil, &resp); err != nil {
		return nil, err
	}
	return resp.Sources, nil
}

func (c *Client) ListSessions(ctx context.Context, pageSize int) ([]Session, error) {
	var resp ListSessionsResponse
	params := map[string]string{"pageSize": fmt.Sprintf("%d", pageSize)}
	if err := c.doRequest(ctx, "GET", "/sessions", params, nil, &resp); err != nil {
		return nil, err
	}
	return resp.Sessions, nil
}

func (c *Client) ListActivities(ctx context.Context, sessionID string, pageSize int) ([]Activity, error) {
	resourcePath := sessionID
	if !strings.HasPrefix(sessionID, "sessions/") {
		resourcePath = "sessions/" + sessionID
	}
	var resp ListActivitiesResponse
	params := map[string]string{"pageSize": fmt.Sprintf("%d", pageSize)}
	if err := c.doRequest(ctx, "GET", "/"+resourcePath+"/activities", params, nil, &resp); err != nil {
		return nil, err
	}
	return resp.Activities, nil
}

func (c *Client) SendMessage(ctx context.Context, sessionID, prompt string) error {
	resourcePath := sessionID
	if !strings.HasPrefix(sessionID, "sessions/") {
		resourcePath = "sessions/" + sessionID
	}
	body := map[string]string{"prompt": prompt}
	return c.doRequest(ctx, "POST", "/"+resourcePath+":sendMessage", nil, body, nil)
}

func (c *Client) doRequest(ctx context.Context, method, path string, params map[string]string, reqBody interface{}, respDest interface{}) error {
	reqURL, err := url.Parse(c.baseURL + path)
	if err != nil {
		return fmt.Errorf("invalid url: %w", err)
	}

	if len(params) > 0 {
		q := reqURL.Query()
		for k, v := range params {
			q.Set(k, v)
		}
		reqURL.RawQuery = q.Encode()
	}

	var bodyReader io.Reader
	if reqBody != nil {
		b, err := json.Marshal(reqBody)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, reqURL.String(), bodyReader)
	if err != nil {
		return err
	}
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("jules api error: %d - %s", resp.StatusCode, string(b))
	}

	if respDest != nil && resp.StatusCode != 204 {
		if err := json.NewDecoder(resp.Body).Decode(respDest); err != nil {
			return err
		}
	}
	return nil
}
