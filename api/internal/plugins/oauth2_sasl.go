package plugins

// Xoauth2Client implements sasl.Client for XOAUTH2
type Xoauth2Client struct {
	Username string
	Token    string
}

func (a *Xoauth2Client) Start() (mech string, ir []byte, err error) {
	mech = "XOAUTH2"
	ir = []byte("user=" + a.Username + "\x01auth=Bearer " + a.Token + "\x01\x01")
	return
}

func (a *Xoauth2Client) Next(challenge []byte) (response []byte, err error) {
	return []byte{}, nil
}
