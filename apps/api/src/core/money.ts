import Decimal from 'decimal.js';
import type { MarkupMethod } from '../../../../packages/contracts/src';
const MAX = new Decimal('9999999999.99');
export function decimal(value: string, positive = false): Decimal {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)) throw new Error('须输入最多两位小数的非负数');
  const result = new Decimal(value);
  if (result.gt(MAX) || (positive && result.lte(0))) throw new Error('金额或数量超出允许范围');
  return result;
}
export function bounded(value: Decimal): string {
  const rounded = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!rounded.isFinite() || rounded.lt(0) || rounded.gt(MAX)) throw new Error('计算结果超出允许范围');
  return rounded.toFixed(2);
}
export function recommend(base: string, method: MarkupMethod, parameter: string): string {
  const price = decimal(base, true), param = decimal(parameter);
  if (method === 'fixed') return bounded(price.plus(param));
  if (method === 'percent') return bounded(price.mul(param.div(100).plus(1)));
  if (method === 'multiplier' && param.gte(1)) return bounded(price.mul(param));
  throw new Error('高开倍率须至少为 1.00');
}
export const lineAmount = (quantity: string, price: string) => bounded(decimal(quantity, true).mul(decimal(price, true)));
export const totalAmount = (amounts: string[]) => bounded(amounts.reduce((sum, value) => sum.plus(decimal(value)), new Decimal(0)));
