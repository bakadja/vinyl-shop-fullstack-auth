export function integerNumber(value) {
  if ((typeof value !== 'string' || !/^-?\d+$/.test(value)) && typeof value !== 'number') throw new Error('Invalid database integer')
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error('Unsafe database integer')
  return number
}

export function countNumber(value) {
  if (value === null) return 0
  const number = integerNumber(value)
  if (number < 0) throw new Error('Invalid database count')
  return number
}

export function priceNumber(value) {
  if ((typeof value !== 'string' || !/^-?\d+(\.\d{1,2})?$/.test(value)) && typeof value !== 'number') throw new Error('Invalid database price')
  const number = Number(value)
  if (!Number.isFinite(number) || Math.abs(number) > 99999999.99 || Math.abs(number * 100 - Math.round(number * 100)) > 0.000002) throw new Error('Invalid database price')
  return number
}
