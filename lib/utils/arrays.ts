/**
 * Used to filter arrays and provide the correct type output
 *
 * @param value - Any value
 * @returns Asserts that a value is not null or undefined
 */
function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined;
}

export { notEmpty };
