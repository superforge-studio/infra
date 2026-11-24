// Which release of the package this is, which every call tells Infra in
// `Infra-Client`, so Infra knows which version each app is on and can say
// when one's out of date. It's written here rather than read from
// package.json as the package runs, since an app's build can bundle the
// package away from its package.json; a test checks the two agree, so a
// release that bumps one and not the other fails `pnpm check`.

/** The package's version, as package.json says it */
export const PACKAGE_VERSION = "0.4.0"

/** What it says: the package and its version, `@superforge/infra/<version>` */
export const CLIENT = `@superforge/infra/${PACKAGE_VERSION}`
