/**
 * KAV - 데이터 파서 유틸리티
 * 텍스트 휴리스틱 및 DOM 추출을 담당합니다.
 */

// 생활기록 데이터를 정규화하고 추출하는 메인 파서 로직
function parseLifeRecord(item) {
  const meta = {
    mood: null,       // 기분
    health: null,     // 건강 상태
    height: null,     // 키 (체격)
    weight: null,     // 몸무게 (체격)
    meals: {          // 식사
      breakfast: null,
      lunch: null,
      dinner: null,
      snack: null,
    },
    sleep: {          // 수면
      bedtime: null,
      wakeup: null,
      duration: null,
    },
    toilet: {         // 배변
      count: null,
      note: null,
    },
    temperature: null, // 체온
    medicine: null,    // 투약 여부
    special_note: null, // 특이사항
  };

  // 1순위: [KAV 기능] DOM에서 추출된 LifeRecord 최우선 사용
  if (item.__lifeRecordDOM) {
    const dom = item.__lifeRecordDOM;
    if (dom['기분']) meta.mood = dom['기분'];
    if (dom['건강']) meta.health = dom['건강'];
    if (dom['체온체크']) meta.temperature = dom['체온체크'];
    if (dom['식사여부']) meta.meals.lunch = dom['식사여부'];
    if (dom['수면시간']) meta.sleep.duration = dom['수면시간'];
    if (dom['배변상태']) meta.toilet.note = dom['배변상태'];
    if (dom['투약']) meta.medicine = dom['투약'];
    if (dom['특이사항']) meta.special_note = dom['특이사항'];
    return meta;
  }

  // 2순위: API 자체 필드명 탐색
  meta.mood = item.mood || item.today_mood || item.child_mood || item.feeling || null;
  meta.health = item.health || item.health_condition || item.health_status || item.condition || null;
  if (item.height || item.body_height) meta.height = item.height || item.body_height;
  if (item.weight || item.body_weight) meta.weight = item.weight || item.body_weight;

  const mealData = item.meal || item.meals || item.eating || {};
  if (typeof mealData === 'object' && mealData !== null) {
    meta.meals.breakfast = mealData.breakfast || mealData.morning || null;
    meta.meals.lunch = mealData.lunch || mealData.afternoon || null;
    meta.meals.dinner = mealData.dinner || mealData.evening || null;
    meta.meals.snack = mealData.snack || mealData.afternoon_snack || null;
  }
  if (item.breakfast) meta.meals.breakfast = item.breakfast;
  if (item.lunch) meta.meals.lunch = item.lunch;
  if (item.dinner) meta.meals.dinner = item.dinner;
  if (item.snack) meta.meals.snack = item.snack;

  const sleepData = item.sleep || item.sleep_info || {};
  if (typeof sleepData === 'object' && sleepData !== null) {
    meta.sleep.bedtime = sleepData.bedtime || sleepData.sleep_time || sleepData.start || null;
    meta.sleep.wakeup = sleepData.wakeup || sleepData.wake_time || sleepData.end || null;
    meta.sleep.duration = sleepData.duration || sleepData.hours || null;
  }
  if (item.sleep_time) meta.sleep.bedtime = item.sleep_time;
  if (item.wake_time) meta.sleep.wakeup = item.wake_time;

  const toiletData = item.toilet || item.defecation || item.bowel || {};
  if (typeof toiletData === 'object' && toiletData !== null) {
    meta.toilet.count = toiletData.count || toiletData.times || null;
    meta.toilet.note = toiletData.note || toiletData.comment || null;
  }
  if (item.defecation_count) meta.toilet.count = item.defecation_count;

  meta.temperature = item.temperature || item.body_temperature || null;
  meta.medicine = item.medicine || item.medication || item.drug || null;
  meta.special_note = item.special_note || item.note || item.remark || null;

  let hasData = Object.values(meta).some(v => {
    if (v === null) return false;
    if (typeof v === 'object') return Object.values(v).some(vv => vv !== null);
    return true;
  });

  // 3순위: 텍스트 기반 스마트 추출 (휴리스틱)
  if (!hasData) {
    const content = item.content || item.description || '';
    if (typeof content === 'string' && content.length > 0) {
      const sentences = content.split(/(?<=[.?!~])\s+|\n/);
      
      for (const sentence of sentences) {
        const s = sentence.trim();
        if (s.length < 5) continue;

        if (!meta.toilet.note && /(응가|대변|묽은\s*변|단단한\s*변|변).+(보|쌌|했|누|봤)/.test(s)) {
          meta.toilet.note = s;
          const cntMatch = s.match(/(번|회)\s*보았|(\d+|한|두|세|네|다섯)\s*(번|회)/);
          if (cntMatch) {
              meta.toilet.count = cntMatch[2] || cntMatch[1];
              if (meta.toilet.count === '한') meta.toilet.count = 1;
              else if (meta.toilet.count === '두') meta.toilet.count = 2;
              else if (meta.toilet.count === '세') meta.toilet.count = 3;
              else if (meta.toilet.count === '네') meta.toilet.count = 4;
          }
          hasData = true;
        }

        if (!meta.sleep.duration && /(낮잠|잠).+(잤|자|들|깨|푹)/.test(s) && !s.includes('잠시')) {
          meta.sleep.duration = s;
          hasData = true;
        }

        if (!meta.meals.lunch && /(밥|점심).+(먹|비웠|비워|맛있|냠냠)/.test(s)) {
          meta.meals.lunch = s;
          hasData = true;
        } else if (!meta.meals.snack && /(간식|오전).+(먹|비웠|맛있|냠냠)/.test(s)) {
          meta.meals.snack = s;
          hasData = true;
        }

        if (!meta.health && /(콧물|기침|감기|열|컨디션).+(조금|많이|저조|심하|나아|좋)/.test(s)) {
          meta.health = s;
          hasData = true;
        }
        if (!meta.medicine && /(약|투약).+(먹|했|완료|주었)/.test(s)) {
          meta.medicine = s;
          hasData = true;
        }
      }
    }
  }

  return hasData ? meta : null;
}

// 상세 페이지 DOM 내에서 댓글(Comment) 요소를 파싱
function extractCommentsFromDOM(detailPageElements) {
  // 이는 클라이언트 브라우저 컨텍스트 (evaluate) 내부에서 동작할 코드 파편을 문자열로 전달하기 위한 유틸입니다.
  // 실제 실행은 Playwright evaluate 내에서 이루어집니다.
}

module.exports = {
  parseLifeRecord
};
