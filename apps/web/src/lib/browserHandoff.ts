/** Only preserve the one-time extension pairing on its two supported web pages.
 * This is a routing hint, never a purchase credential or provider login. */
export function browserHandoffHash(path:string,hash:string):string {
  return ['/draft-kit','/create-league'].includes(path)
    && /^#citrus-bridge=[a-p]{32}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(hash)?hash:'';
}
