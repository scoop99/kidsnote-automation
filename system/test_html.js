const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('../report.html', 'utf8');
const $ = cheerio.load(html);
const log = [];
$('*').each((i, el) => {
  const text = $(el).clone().children().remove().end().text().trim();
  if (['기분', '건강', '체온', '식사', '수면', '배변'].includes(text)) {
    log.push($(el).parent().text().replace(/\s+/g, ' ').trim());
  }
});
console.log(JSON.stringify(log, null, 2));
