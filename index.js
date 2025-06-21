require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');

const coins = ['BTC', 'ETH'];
const labelMap = {
  '3rd Resistance Point': '第 3 個阻力點',
  '2nd Resistance Point': '第 2 阻力點',
  '1st Resistance Point': '第 1 阻力點',
  'Last Price': '最新價',
  '1st Support Level': '第 1 支撐級別',
  '2nd Support Level': '第 2 支撐級別',
  '3rd Support Level': '第 3 支撐級別'
};

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('⛔️ TELEGRAM_TOKEN / TELEGRAM_CHAT_ID 未設定於 .env 檔');
  process.exit(1);
}

async function sendTelegram(text) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.log('❌ 發送 Telegram 失敗:', err.message);
  }
}

async function runTask() {
  console.log('\n🚀 任務啟動', new Date().toLocaleString('zh-TW'));

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 375, height: 812 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  if (!fs.existsSync('screenshots')) fs.mkdirSync('screenshots');
  if (!fs.existsSync('data')) fs.mkdirSync('data');

  for (const coin of coins) {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );

    const url = `https://www.barchart.com/crypto/quotes/%5E${coin}USDT/opinion`;
    console.log(`🔍 [${coin}] 前往 ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 0 });
    await autoScroll(page);

    const targetHandle = await page.evaluateHandle(() => {
      for (const el of document.querySelectorAll('.background-widget')) {
        const h3 = el.querySelector('h3');
        if (h3 && h3.textContent.includes('Support & Resistance')) return el;
      }
      return null;
    });

    if (!targetHandle) {
      console.log(`❌ [${coin}] 找不到 Support & Resistance 區塊`);
      await page.close();
      continue;
    }

    const rawData = await targetHandle.evaluate(el => {
      const obj = {};
      el.querySelectorAll('tr').forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length === 2) obj[tds[0].innerText.trim()] = tds[1].innerText.trim();
      });
      return obj;
    });

    const srData = {};
    for (const [enKey, value] of Object.entries(rawData)) {
      const zhKey = labelMap[enKey] || enKey;
      srData[zhKey] = value;
    }

    const jsonPath = path.join('data', `${coin}_sr.json`);
    const newStr = JSON.stringify(srData, null, 2);

    if (fs.existsSync(jsonPath)) {
      const prevStr = fs.readFileSync(jsonPath, 'utf-8');
      if (newStr === prevStr) {
        console.log(`🟡 [${coin}] 支撐阻力未變動`);
        await page.close();
        continue;
      }
    }

    console.log(`📊 [${coin}]`, srData);
    fs.writeFileSync(jsonPath, newStr);

    await targetHandle.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const imgPath = path.join('screenshots', `${coin}_sr_table.png`);
    await targetHandle.asElement().screenshot({ path: imgPath });

    const message =
      `📈 *${coin} 支撐 / 阻力更新*\n\n` +
      Object.entries(srData).map(([k, v]) => `- ${k}：${v}`).join('\n');

    await sendTelegram(message);
    console.log(`✅ [${coin}] 已更新並發送通知`);
    await page.close();
  }

  await browser.close();
  console.log('🎉 任務完成\n');
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const step = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
}

// ➜ 每日台灣時間 00:05 執行（UTC+8 = UTC-16）
cron.schedule('5 16 * * *', () => {
  runTask();
});
