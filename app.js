'use strict';

/**
 * 월별 상환 스케줄 계산
 * @param {number} principal 대출 원금 (원)
 * @param {number} annualRate 연 이자율 (%)
 * @param {number} months 총 대출 기간 (개월)
 * @param {number} graceMonths 거치 기간 (개월) - 이자만 납부
 * @param {'equal-payment'|'equal-principal'|'bullet'} method 상환 방식
 * @returns {{month:number, payment:number, principal:number, interest:number, balance:number}[]}
 */
function calcSchedule(principal, annualRate, months, graceMonths, method) {
  const r = annualRate / 100 / 12;
  const schedule = [];
  let balance = principal;

  // 만기일시는 거치 개념이 없으므로 거치 기간 무시
  const grace = method === 'bullet' ? 0 : graceMonths;
  const repayMonths = months - grace;

  const fixedPayment =
    r === 0
      ? principal / repayMonths
      : (principal * r * Math.pow(1 + r, repayMonths)) / (Math.pow(1 + r, repayMonths) - 1);
  const fixedPrincipal = principal / repayMonths;

  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    let principalPart = 0;

    if (m > grace) {
      if (method === 'equal-payment') {
        principalPart = fixedPayment - interest;
      } else if (method === 'equal-principal') {
        principalPart = fixedPrincipal;
      } else if (method === 'bullet') {
        principalPart = m === months ? balance : 0;
      }
    }

    // 마지막 회차에 남은 잔액(반올림 오차) 정리
    if (m === months) principalPart = balance;

    balance -= principalPart;
    schedule.push({
      month: m,
      payment: principalPart + interest,
      principal: principalPart,
      interest,
      balance: Math.max(balance, 0),
    });
  }
  return schedule;
}

const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

const $ = (id) => document.getElementById(id);

/** 쉼표가 들어간 금액 입력값 → 숫자 */
const money = (id) => Number($(id).value.replace(/[^\d]/g, ''));

/** 금액 입력칸: 입력 중 000,000,000 형식으로 쉼표 자동 삽입 (커서 위치 유지) */
function formatMoneyInput(el) {
  const caret = el.selectionStart ?? el.value.length;
  const digitsBefore = el.value.slice(0, caret).replace(/[^\d]/g, '').length;
  const digits = el.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
  el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  let pos = 0;
  for (let seen = 0; pos < el.value.length && seen < digitsBefore; pos++) {
    if (/\d/.test(el.value[pos])) seen++;
  }
  el.setSelectionRange(pos, pos);
}

document.querySelectorAll('input.money').forEach((el) => {
  el.addEventListener('input', () => formatMoneyInput(el));
});

$('loan-form').addEventListener('submit', (e) => {
  e.preventDefault();

  const principal = money('principal') * 10000;
  const rate = Number($('rate').value);
  const years = Number($('years').value);
  const graceYears = Number($('grace').value) || 0;
  const method = document.querySelector('input[name="method"]:checked').value;

  const err = $('error');
  let msg = '';
  if (!(principal > 0)) msg = '대출 금액을 입력해주세요.';
  else if (!(rate >= 0)) msg = '이자율을 올바르게 입력해주세요.';
  else if (!(years >= 1)) msg = '대출 기간은 1년 이상이어야 합니다.';
  else if (graceYears < 0 || (method !== 'bullet' && graceYears >= years))
    msg = '거치 기간은 대출 기간보다 짧아야 합니다.';

  if (msg) {
    err.textContent = msg;
    err.hidden = false;
    $('result').hidden = true;
    return;
  }
  err.hidden = true;

  const schedule = calcSchedule(principal, rate, years * 12, graceYears * 12, method);
  const totalInterest = schedule.reduce((s, row) => s + row.interest, 0);

  $('first-payment').textContent = won(schedule[0].payment);
  $('total-interest').textContent = won(totalInterest);
  $('total-payment').textContent = won(principal + totalInterest);

  $('schedule').innerHTML = schedule
    .map(
      (row) =>
        `<tr><td>${row.month}</td><td>${won(row.payment)}</td><td>${won(row.principal)}</td>` +
        `<td>${won(row.interest)}</td><td>${won(row.balance)}</td></tr>`
    )
    .join('');

  $('result').hidden = false;
});
