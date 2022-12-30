const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const host = 'localhost';
const port = 8080;

const app = express();
// 本プログラムでは、Expressはstatic以下のファイルのGETにのみ用いています。
app.use(express.static('static'));

// ExpressとSocket.ioを同じポートで動作させる場合、
// http.createServerにappを渡して
// 生成されたhttp.Serverオブジェクトでlistenすること。
// app.listenは使いません
var server = http.createServer(app);
server.listen({ host, port }, () => {
  console.log(`Starting Express and Socket.io (websocket) server at http://${host}:${port}/`)
});

const io = new Server(server);

const rooms = {};
io.on('connection', socket => {
  // （１）入室時の処理
  const ip = socket.handshake.address;
  // 1-1) 入室したユーザの名前を取得
  const userName = socket.handshake.query.userName;
  if (userName === undefined || userName === "") {
    console.log('Disconnected: User name not found.');
    socket.disconnect(true);
    return;
  }
  // roomName が undefined や '' のときは main
  // 部屋の移動時に変更があるため、const ではなく let にする。
  let roomName = socket.handshake.query.roomName || 'main';

  // roonName へ入室
  socket.join(roomName);

  // ルームへメンバーを追加
  // 同じ名前のユーザが接続してきた場合には未対応
  if (!rooms[roomName]) {
    rooms[roomName] = {};
    // ルームのメンバーを格納するオブジェクト
    rooms[roomName].members = {};
    // ルームのログを格納する配列
    rooms[roomName].log = [];
  }
  rooms[roomName].members[userName] = socket;

  // 過去ログを送信
  socket.emit('log', rooms[roomName].log);

  console.log(`[WebSocket] connected from [${roomName}] ${userName} (${ip})`);
  // 1-2) 全ての入室中のクライアントへ通知
  const mes = {
    type: 'enter',
    name: userName,
    roomName,
  };
  io.to(roomName).emit('chat message', mes);
  // ログに追加
  rooms[roomName].log.push(mes);

  // (2) メッセージ受信時の処理を追加
  socket.on('chat message', req => {
    console.log('[WebSocket] message from client: ' + JSON.stringify(req));

    // メッセージに roomName を加える
    req.roomName = roomName;

    // 誰宛のメッセージか確認
    let messageTo = '';
    // 念のため日本語の空白文字も加えておく（なくてもよい）
    const msgArr = req.data.split(/[ 　]/);
    if (msgArr.length >= 2) {
      messageTo = msgArr[0].slice(1); // 先頭の@を削除
      if (messageTo === 'bot') {
        req.name = 'bot';
        if (msgArr[1] === 'date') {
          req.data = Date();
        }
        else if (msgArr[1] === 'list') {
          req.data = '現在の入室者は ' + Object.keys(rooms[roomName].members).join(', ');
        }
        else if (msgArr[1] === 'join') {
          if (msgArr.length >= 3) {
            // 現在の部屋から退出
            socket.leave(roomName);
            let mes = {
              type: 'leave',
              name: userName,
              roomName,
            };
            io.to(roomName).emit('chat message', mes);
            // ログに追加
            rooms[roomName].log.push(mes);

            // rooms から削除
            delete rooms[roomName].members[userName];

            // 指定の部屋へ入室
            roomName = msgArr[2];
            console.log(`${userName} join to ${roomName}`);
            // 存在しない部屋が指定された場合は作成
            if (!rooms[roomName]) {
              rooms[roomName] = {};
              // ルームのメンバーを格納するオブジェクト
              rooms[roomName].members = {};
              // ルームのログを格納する配列
              rooms[roomName].log = [];
            }
            rooms[roomName].members[userName] = socket;
            socket.join(roomName);

            mes = {
              type: 'enter',
              name: userName,
              roomName,
            };
            io.to(roomName).emit('chat message', mes);
            // ログに追加
            rooms[roomName].log.push(mes);
            return;
          }
        }
        else {
          return;
        }
        // 送信元のクライアントにのみ返信
        socket.emit('chat message', req);

        // bot の場合はここで終わり。
        return;
      }
    }

    // bot宛でないメッセージの場合
    // 送信元のuserNameをnameプロパティを追加
    req.name = userName;

    if(messageTo && rooms[roomName].members[messageTo]) {
      // 自分自身と指定クライアントへのみ転送
      socket.emit('chat message', req);
      rooms[roomName].members[messageTo].emit('chat message', req);
    }
    else {
      // 全ての入室中のクライアントへ転送
      io.to(roomName).emit('chat message', req);
      // ログに追加
      rooms[roomName].log.push(req);
    }
  });

  // (3) 退室時の処理を追加
  socket.on('disconnect', () => {
    console.log(`[WebSocket] disconnected from ${userName} (${ip})`);

    // すべてのルームからメンバーを削除
    // （クライアントの不正な切断による退室には未対応）
    Object.keys(rooms).forEach(roomName => {
      if (rooms[roomName].members[userName]) {
        // 退室したクライアントを除く全ての入室中のクライアントへ送信
        const mes = {
          type: 'leave',
          name: userName,
          roomName,
        };
        socket.to(roomName).emit('chat message', mes);
        // ログに追加
        rooms[roomName].log.push(mes);
      }
      delete rooms[roomName].members[userName];
    });
  });

  // (4) タイピング中というイベントを処理
  socket.on('typing', () => {
    // イベントを通知してきたクライアントを除く全ての入室中のクライアントへ送信
    socket.to(roomName).emit('chat message', {
      type: 'typing',
      name: userName,
      roomName,
    });
  });
});
