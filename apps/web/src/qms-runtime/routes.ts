/** Routes hosted by the preserved React Router workflow screens. */
export function isOperationalPath(pathname: string) {
  return /^(\/$|\/login$|\/my-inspections$|\/inspections(?:\/|$)|\/ncrs(?:\/|$)|\/quality-alerts$|\/drawings$|\/reports$|\/admin$|\/injector-tests$|\/injector-reports$)/.test(
    pathname,
  );
}
