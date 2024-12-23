/**
 * Asserts that an environment variable is not undefined
 *
 * @param env - Name of environment variable is set
 * @throws {TypeError} if environment variable is undefined
 *
 * @returns The value
 */
const assertEnv = (env: string): string => {
  const value = process.env[env];

  if (value === undefined)
    throw new TypeError(`Environment variable '${env}' was undefined`);

  return value;
};

/**
 * Assert that a set of environment variables are set and return a typed record
 *
 * @param envs - List of environment variables to assert
 * @returns Record on asserted environment variables
 */
const assertEnvs = <TEnv extends string>(
  ...envs: TEnv[]
): Record<TEnv, string> => {
  const data = envs.reduce((record, env) => {
    record[env] = assertEnv(env);
    return record;
  }, {} as Record<TEnv, string>);

  return data;
};

export { assertEnv, assertEnvs };
