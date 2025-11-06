package streamer

// import (
// 	"context"
// 	"encoding/json"
// 	"sync"

// 	"github.com/gorilla/websocket"
// 	"github.com/kliuchnikovv/genie-api/internal/storage"
// 	"go.uber.org/zap"
// )

// type Streamer struct {
// 	storage *storage.Storage
// 	logger  *zap.Logger
// }

// func New() *Streamer {

// }

// func (streamer *Streamer) Stream(
// 	model *websocket.Conn,
// 	clients ...*websocket.Conn, // TODO: may be many clients
// ) error {
// 	var (
// 		wg          = &sync.WaitGroup{}
// 		modelsChan  = make(chan Frame, len(clients))
// 		clientChans = make([]chan Frame, len(clients))
// 	)

// 	wg.Add(len(clients))
// 	for i := range clients {
// 		clientChans[i] = make(chan Frame, 1)

// 		go streamer.clientWorker(
// 			clients[i],
// 			modelsChan,
// 			clientChans[i],
// 			wg,
// 		)
// 	}
// }

// func (streamer *Streamer) clientWorker(
// 	ctx context.Context,
// 	client *websocket.Conn,
// 	modelChan,
// 	clientChan chan Frame,
// 	wg *sync.WaitGroup,
// 	logger *zap.Logger,
// ) {
// 	defer wg.Done()
// 	defer client.Close()

// 	var (
// 		msg []byte
// 		err error
// 	)
// 	for {
// 		select {
// 		case frame, ok := <-clientChan:
// 			if !ok {
// 				logger.Debug("client chan is closed")
// 				break
// 			}

// 			client.WriteMessage(websocket.TextMessage, []byte(frame.Data.Delta)))

// 			modelChan <- frame
// 			continue
// 		case <-ctx.Done():
// 			logger.Debug("context done")
// 			break
// 		default:
// 			_, msg, err = client.ReadMessage()
// 			if err != nil {
// 				if websocket.IsCloseError(err) {
// 					logger.Info("got close message from client")
// 				} else {
// 					logger.Error(
// 						"got reading error",
// 						zap.Error(err),
// 					)
// 				}
// 				break
// 			}

// 			logger.Debug(
// 				"got message from client",
// 				zap.String("message", string(msg)),
// 			)

// 			modelChan <- Frame{
// 				Event: Token,
// 				Data: Data{
// 					Delta: string(msg),
// 				},
// 			}
// 		}
// 	}
// }

// func (streamer *Streamer) modelWorker(
// 	model *websocket.Conn,
// 	clientChans ...chan Frame,
// ) {

// }

// func (streamer *Streamer) sendTo(
// 	conn *websocket.Conn,
// 	event Event,
// 	data Data,
// ) error {
// 	meta := Frame{
// 		Event: event,
// 		Data:  data,
// 	}

// 	b, err := json.Marshal(meta)
// 	if err != nil {
// 		return err
// 	}

// 	return conn.WriteMessage(websocket.TextMessage, b)
// }

// func safeSend[T any](ch chan T, val T) (ok bool) {
// 	defer func() {
// 		if r := recover(); r != nil {
// 			ok = false // канал закрыт
// 		}
// 	}()
// 	ch <- val
// 	return true
// }
