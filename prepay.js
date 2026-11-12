'use strict';

/* ---------- 계산 로직 ---------- */

/** 원리금균등 월 납입액 */
function annuityPayment(balance, r, n) {
  if (n <= 0) return balance;
  if (r === 0) return balance / n;
  const f = Math.pow(1 + r, n);
  return (balance * r * f) / (f - 1);
}

/**
 * 고정 납입액으로 상환할 때의 스케줄.
 * maxMonths 회차에 도달하거나 납입액이 잔액보다 크면 남은 잔액을 모두 상환한다.
 */
function amortize(balance, r, payment, maxMonths) {
  const rows = [];
  let totalInterest = 0;
  for (let m = 1; m <= maxMonths && balance > 0.5; m++) {
    const interest = balance * r;
    let principal = payment - interest;
    if (principal >= balance || m === maxMonths) principal = balance;
    balance -= principal;
    totalInterest += interest;
    rows.push({ month: m, payment: principal + interest, principal, interest, balance: Math.max(balance, 0) });
  }
  return { rows, months: rows.length, totalInterest };
}

/** 'YYYY-MM-DD' → 로컬 Date */
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 기준일 이후 첫 납입일. 기준일이 납입일이면 그날 납입은 끝난 것으로 본다. */
function nextPaymentDate(base, payDay) {
  const y = base.getFullYear();
  const m = base.getMonth() + (base.getDate() >= payDay ? 1 : 0);
  return makePayDate(y, m, payDay);
}

/** 월말을 넘기지 않는 납입일 생성 (예: 31일 → 2월 28일) */
function makePayDate(y, m, payDay) {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(payDay, last));
}

function addMonths(date, n, payDay) {
  return makePayDate(date.getFullYear(), date.getMonth() + n, payDay);
}

/** 기준일 다음 납입일부터 만기일까지 남은 회차 */
function remainingMonths(base, maturity) {
  const next = nextPaymentDate(base, maturity.getDate());
  const diff = (maturity.getFullYear() - next.getFullYear()) * 12 + (maturity.getMonth() - next.getMonth());
  return { months: diff + 1, next };
}

/** 중도상환수수료: 상환액 × 수수료율 × (3년 중 남은 일수 / 3년 일수) */
function prepayFee(amount, feeRate, start, base) {
  if (!(feeRate > 0) || !start) return 0;
  const end = new Date(start.getFullYear() + 3, start.getMonth(), start.getDate());
  if (base >= end) return 0;
  const total = (end - start) / 86400000;
  const left = (end - base) / 86400000;
  return amount * (feeRate / 100) * Math.min(left / total, 1);
}

/** 중도상환 시나리오 계산 */
function simulatePrepay({ balance, rate, months, amount, mode, fee }) {
  const r = rate / 100 / 12;
  const curPayment = annuityPayment(balance, r, months);
  const cur = amortize(balance, r, curPayment, months);

  const newBalance = balance - amount;
  let after;
  let newPayment;
  if (newBalance <= 0.5) {
    after = { rows: [], months: 0, totalInterest: 0 };
    newPayment = 0;
  } else if (mode === 'keep-term') {
    newPayment = annuityPayment(newBalance, r, months);
    after = amortize(newBalance, r, newPayment, months);
  } else {
    newPayment = curPayment;
    after = amortize(newBalance, r, curPayment, months);
  }

  return {
    curPayment,
    curMonths: months,
    curInterest: cur.totalInterest,
    newBalance: Math.max(newBalance, 0),
    newPayment,
    newMonths: after.months,
    newInterest: after.totalInterest,
    saved: cur.totalInterest - after.totalInterest - fee,
    schedule: after.rows,
  };
}

/* ---------- 화면 ---------- */

const fmtDate = (d) =>
  `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

const signed = (n, unit = '원') => {
  const v = Math.round(n);
  if (v === 0) return '-';
  return (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('ko-KR') + unit;
};

const monthsText = (n) => {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return `${n}회` + (n >= 12 ? ` (${y}년${m ? ` ${m}개월` : ''})` : '');
};

/** 433086594 → "4억 3,308만 6,594원" */
function koreanWon(n) {
  n = Math.round(n);
  if (!(n > 0)) return '';
  const eok = Math.floor(n / 1e8);
  const man = Math.floor((n % 1e8) / 1e4);
  const rest = n % 1e4;
  const parts = [];
  if (eok) parts.push(`${eok.toLocaleString('ko-KR')}억`);
  if (man) parts.push(`${man.toLocaleString('ko-KR')}만`);
  if (rest) parts.push(rest.toLocaleString('ko-KR'));
  return parts.join(' ') + '원';
}

function updateHints() {
  document.querySelectorAll('.hint[data-for]').forEach((el) => {
    el.textContent = koreanWon(money(el.dataset.for));
  });
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function runPrepay() {
  const balance = money('pp-balance');
  const rate = Number($('pp-rate').value);
  const original = money('pp-original');
  const start = parseDate($('pp-start').value);
  const maturity = parseDate($('pp-maturity').value);
  const base = parseDate($('pp-date').value);
  const amount = money('pp-amount');
  const feeRate = Number($('pp-fee').value) || 0;
  const mode = document.querySelector('input[name="pp-mode"]:checked').value;

  const err = $('pp-error');
  let msg = '';
  if (!(balance > 0)) msg = '현재 대출 잔액을 입력해주세요.';
  else if (!(rate >= 0)) msg = '이자율을 올바르게 입력해주세요.';
  else if (!maturity || !base) msg = '만기일과 중도상환일을 입력해주세요.';
  else if (base >= maturity) msg = '중도상환일은 만기일보다 앞서야 합니다.';
  else if (!(amount > 0)) msg = '중도상환 금액을 입력해주세요.';
  else if (amount > balance) msg = '중도상환 금액이 대출 잔액보다 큽니다.';

  if (msg) {
    err.textContent = msg;
    err.hidden = false;
    $('pp-result').hidden = true;
    return;
  }
  err.hidden = true;

  const payDay = maturity.getDate();
  const { months, next } = remainingMonths(base, maturity);
  const fee = prepayFee(amount, feeRate, start, base);
  const res = simulatePrepay({ balance, rate, months, amount, mode, fee });

  // 상태 요약
  let status = `다음 납입일 ${fmtDate(next)} · 남은 회차 ${monthsText(months)}`;
  if (original > 0) status += ` · 상환 진행률 ${(((original - balance) / original) * 100).toFixed(1)}%`;
  $('pp-status').textContent = status;

  const newMaturity = res.newMonths > 0 ? addMonths(next, res.newMonths - 1, payDay) : base;

  // 요약 카드
  $('pp-new-payment').textContent = won(res.newPayment);
  $('pp-new-payment-diff').textContent = signed(res.newPayment - res.curPayment);
  $('pp-new-months').textContent = `${res.newMonths}회`;
  $('pp-new-months-diff').textContent =
    res.newMonths === months ? '만기 동일' : `${months - res.newMonths}개월 단축 · 만기 ${fmtDate(newMaturity)}`;
  $('pp-saved').textContent = won(res.saved);

  // 전후 비교
  const rows = [
    ['대출 잔액', won(balance), won(res.newBalance), signed(res.newBalance - balance)],
    ['월 납입액', won(res.curPayment), won(res.newPayment), signed(res.newPayment - res.curPayment)],
    ['남은 회차', `${months}회`, `${res.newMonths}회`, res.newMonths === months ? '-' : `−${months - res.newMonths}회`],
    ['만기일', fmtDate(maturity), fmtDate(newMaturity), ''],
    ['남은 총 이자', won(res.curInterest), won(res.newInterest), signed(res.newInterest - res.curInterest)],
    ['중도상환수수료', '-', won(fee), ''],
    ['남은 총 상환액', won(balance + res.curInterest), won(amount + fee + res.newBalance + res.newInterest),
      signed(amount + fee + res.newBalance + res.newInterest - balance - res.curInterest)],
  ];
  $('pp-compare').innerHTML = rows
    .map((c) => `<tr><td class="label">${c[0]}</td><td>${c[1]}</td><td>${c[2]}</td><td>${c[3]}</td></tr>`)
    .join('');

  // 금액별 비교
  const presets = [10e6, 30e6, 50e6, 100e6, 200e6].filter((a) => a < balance);
  if (!presets.includes(amount)) presets.push(amount);
  presets.sort((a, b) => a - b);
  $('pp-scenarios').innerHTML = presets
    .map((a) => {
      const f = prepayFee(a, feeRate, start, base);
      const t = simulatePrepay({ balance, rate, months, amount: a, mode: 'keep-term', fee: f });
      const p = simulatePrepay({ balance, rate, months, amount: a, mode: 'keep-payment', fee: f });
      const cls = a === amount ? ' class="current"' : '';
      return (
        `<tr${cls}><td>${won(a)}</td><td>${won(t.newPayment)}</td><td>${won(t.saved)}</td>` +
        `<td>${p.newMonths}회</td><td>${months - p.newMonths}개월</td><td>${won(p.saved)}</td></tr>`
      );
    })
    .join('');

  // 상환 후 스케줄
  $('pp-schedule').innerHTML = res.schedule
    .map(
      (row) =>
        `<tr><td>${row.month}</td><td>${fmtDate(addMonths(next, row.month - 1, payDay))}</td>` +
        `<td>${won(row.payment)}</td><td>${won(row.principal)}</td><td>${won(row.interest)}</td><td>${won(row.balance)}</td></tr>`
    )
    .join('');

  $('pp-result').hidden = false;
}

/* ---------- 초기화 ---------- */

// 탭 전환
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.hidden = p.id !== `tab-${btn.dataset.tab}`;
    });
  });
});

$('pp-date').value = toISO(new Date());
document.querySelectorAll('#prepay-form input.money').forEach((el) => el.addEventListener('input', updateHints));
updateHints();

$('prepay-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runPrepay();
});
runPrepay();
