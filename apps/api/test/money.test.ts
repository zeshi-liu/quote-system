import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimal, recommend, lineAmount, totalAmount } from '../src/core/money';

test('输入金额拒绝非法精度、指数、负数及超过 NUMERIC(12,2) 的值', () => {
  for (const value of ['0.001', '-1', '1e3', 'Infinity', '10000000000.00', '', ' 1.00']) assert.throws(() => decimal(value));
  assert.equal(decimal('1').toFixed(2), '1.00');
  assert.throws(() => decimal('0', true));
});
test('三种加价按十进制计算，推荐价和数量乘价各自四舍五入', () => {
  assert.equal(recommend('25.80', 'fixed', '3.00'), '28.80');
  assert.equal(recommend('25.80', 'percent', '10.00'), '28.38');
  assert.equal(recommend('25.80', 'multiplier', '1.20'), '30.96');
  assert.equal(lineAmount('12.50', '0.01'), '0.13');
  assert.equal(totalAmount(['0.13', '1.20']), '1.33');
  assert.throws(() => recommend('20.00', 'multiplier', '0.99'));
  assert.throws(() => lineAmount('9999999999.99', '9999999999.99'));
});
