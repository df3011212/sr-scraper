require('dotenv').config();
const puppeteer = require('puppeteer');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const cron    = require('node-cron');          // ← 定時任務

/* ===== 基本設定 ===== */
const coins = ['BTC', 'ETH'];
const labelMap = {
  '3rd Resistance Point': '第 3 個阻力點',
  '2nd Resistance Point': '第 2 阻力點',
  '1st Resistance Point': '第 1 阻力點',
  'Last Price':           '最新價',
  '1st Support Level':    '第 1 支撐級別',
  '2nd Support Level':    '第 2 支撐級別',
  '3rd Support Level':    '第 3 支撐級別'
};
const TZ = 'Asia/Taipei';

/* ===== Telegram 發送 ===== */
async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(url, { chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' });
}

/* ===== 主要抓取邏輯 ===== */
async function runTask() {
  console.log('\n🚀 任務啟動', new Date().toLocaleString('zh-TW', { timeZone: TZ }));

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 375, height: 812 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  if (!fs.existsSync('screenshots')) fs.mkdirSync('screenshots');
  if (!fs.existsSync('data')) fs.mkdirSync('data');

  const tsFile = new Date().toLocaleString('sv-SE', { timeZone: TZ })
                .replace(' ', '_').replace(/:/g, '-'); // 2025-06-22_12-05-00
  const tsText = new Date().toLocaleString('zh-TW', { timeZone: TZ, hour12:false,
                year:'numeric', month:'2-digit', day:'2-digit',
                hour:'2-digit', minute:'2-digit' });   // 2025/06/22 12:05

  for (const coin of coins) {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );
    const url = `https://www.barchart.com/crypto/quotes/%5E${coin}USDT/opinion`;
    console.log(`🔍 [${coin}] ${url}`);

    try {
      await page.goto(url, { waitUntil:'domcontentloaded', timeout:0 });
      await autoScroll(page);

      const target = await page.evaluateHandle(() => {
        for (const el of document.querySelectorAll('.background-widget')) {
          if (el.querySelector('h3')?.textContent.includes('Support & Resistance')) return el;
        }
        return null;
      });
      if (!target) throw new Error('找不到 Support & Resistance 區塊');

      const raw = await target.evaluate(el => {
        const o={}; el.querySelectorAll('tr').forEach(tr=>{
          const [k,v]=[...tr.querySelectorAll('td')].map(t=>t.innerText.trim());
          if(k&&v) o[k]=v;
        }); return o;
      });

      const sr={}; for(const [k,v] of Object.entries(raw)) sr[labelMap[k]||k]=v;

      const latestJson = path.join('data', `${coin}_sr.json`);
      const newStr = JSON.stringify(sr, null, 2);
      if (fs.existsSync(latestJson) && newStr === fs.readFileSync(latestJson,'utf8')) {
        console.log(`🟡 [${coin}] 未變動`); await page.close(); continue;
      }

      /* 儲存與截圖 */
      const base = `${coin}_sr_${tsFile}`;
      fs.writeFileSync(path.join('data', `${base}.json`), newStr);
      fs.writeFileSync(latestJson, newStr);
      await target.evaluate(el=>el.scrollIntoView({block:'center'}));
      await target.asElement().screenshot({ path: path.join('screenshots', `${base}.png`) });

      /* 推送 Telegram */
      const msg = `📈 *${coin} 支撐 / 阻力更新*\n🕒 ${tsText}\n\n` +
        Object.entries(sr).map(([k,v])=>`• *${k}*：${v}`).join('\n');
      await sendTelegram(msg);
      console.log(`✅ [${coin}] 已更新並推播`);
    } catch(e){ console.log(`❌ [${coin}]`, e.message); }
    await page.close();
  }

  await browser.close();
  console.log('🎉 任務完成');
}

/* 滾動觸發 lazy load */
async function autoScroll(page){
  await page.evaluate(async()=>{
    await new Promise(ok=>{
      let h=0; const step=300;
      const id=setInterval(()=>{
        window.scrollBy(0,step); h+=step;
        if(h>=document.body.scrollHeight-window.innerHeight){clearInterval(id); ok();}
      },150);
    });
  });
}

/* ===== 每日 12:05 (台灣) 排程 ===== */
cron.schedule('5 12 * * *', runTask, { timezone: TZ });

/* 若想立即本地測試，取消下一行註解 */
// runTask();
