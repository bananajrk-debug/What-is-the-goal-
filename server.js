const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 静的ファイルの読み込み設定
app.use(express.static(path.join(__dirname)));

// メインページのルーティング
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(` セノビックブラザーズ 起動完了！`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(`=================================`);
});
