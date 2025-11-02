package providers

var googleScopeMapping = map[string][]string{
	"profile:read": {
		"openid",
		"https://www.googleapis.com/auth/userinfo.email",
		"https://www.googleapis.com/auth/userinfo.profile",
	},
	"calendar:read": {
		"https://www.googleapis.com/auth/calendar.readonly",
	},
	"calendar:write": {
		"https://www.googleapis.com/auth/calendar",
		"https://www.googleapis.com/auth/calendar.readonly",
	},
	"gmail:read": {
		"https://www.googleapis.com/auth/gmail.readonly",
	},
	"gmail:write": {
		"https://www.googleapis.com/auth/gmail.modify",
		"https://www.googleapis.com/auth/gmail.readonly",
	},
	"drive:read": {
		"https://www.googleapis.com/auth/drive.readonly",
	},
	"drive:write": {
		"https://www.googleapis.com/auth/drive",
		"https://www.googleapis.com/auth/drive.readonly",
	},
	"sheets:read": {
		"https://www.googleapis.com/auth/spreadsheets.readonly",
	},
	"sheets:write": {
		"https://www.googleapis.com/auth/spreadsheets",
		"https://www.googleapis.com/auth/spreadsheets.readonly",
	},
}

func GetGoogleScope(scope string) []string {
	return googleScopeMapping[scope]
}
