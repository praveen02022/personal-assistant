/** First-run welcome: remembered per device (it is a convenience, not account state). */
const KEY = "pos.welcome";

export function hasSeenWelcome(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "seen";
  } catch {
    return true; // storage blocked: don't keep showing the welcome
  }
}

export function markWelcomeSeen() {
  try {
    window.localStorage.setItem(KEY, "seen");
  } catch {
    // ignore
  }
}
