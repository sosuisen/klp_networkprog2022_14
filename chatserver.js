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

const members = {};
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
  const roomName = socket.handshake.query.roomName || 'main';

  // roonName へ入室
  socket.join(roomName);

  // ルームへメンバーを追加
  // 同じ名前のユーザが接続してきた場合には未対応
  if (!members[roomName]) {
    members[roomName] = {};
  }
  members[roomName][userName] = socket;

  console.log(`[WebSocket] connected from [${roomName}] ${userName} (${ip})`);
  // 1-2) 全ての入室中のクライアントへ通知
  io.to(roomName).emit('chat message', {
    type: 'enter',
    name: userName,
    roomName,
  });

  // (2) メッセージ受信時の処理を追加
  socket.on('chat message', req => {
    console.log('[WebSocket] message from client: ' + JSON.stringify(req));

    // メッセージに roomName を加える
    req.roomName = roomName;

    // 誰宛のメッセージか確認
    let messageTo = '';
    let message = req.data;
    // 念のため日本語の空白文字も加えておく（なくてもよい）
    const match = /^@(.+)[ 　](.+)$/.exec(req.data);
    if (match) {
      messageTo = match[1];
      message = match[2];
    }

    if (messageTo === 'bot') {
      if (message !== ''){
        req.name = 'bot';
        if (message === 'date') {
          req.data = Date();
        }
        else if (message === 'list') {
          req.data = '現在の入室者は ' + Object.keys(members[roomName]).join(', ');
        }
        else {
          return;
        }
        // 送信元のクライアントにのみ返信
        socket.emit('chat message', req);
      }
      // bot の場合はここで終わり。
      return;
    }

    // bot宛でないメッセージの場合
    // 送信元のuserNameをnameプロパティを追加
    req.name = userName;

    if(messageTo && members[roomName][messageTo]) {
      // 自分自身と指定クライアントへのみ転送
      socket.emit('chat message', req);
      members[roomName][messageTo].emit('chat message', req);
    }
    else {
      // 全ての入室中のクライアントへ転送
      io.to(roomName).emit('chat message', req);
    }
  });

  // (3) 退室時の処理を追加
  socket.on('disconnect', () => {
    console.log(`[WebSocket] disconnected from ${userName} (${ip})`);

    // すべてのルームからメンバーを削除
    // （クライアントの不正な切断による退室には未対応）
    Object.keys(members).forEach(roomName => {
      if (members[roomName][userName]) {
        // 退室したクライアントを除く全ての入室中のクライアントへ送信
        socket.to(roomName).emit('chat message', {
          type: 'leave',
          name: userName,
          roomName,
        });
      }
      delete members[roomName][userName];
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
