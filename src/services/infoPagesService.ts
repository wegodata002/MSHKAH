import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  checkPublish,
  INFO_PAGES_DOC,
  parseInfoPages,
  tidyCopy,
  type InfoPageCopy,
  type InfoPageId,
  type InfoPages,
} from "@/lib/info-pages/content";
import { INFO_PAGE_DRAFTS } from "@/lib/info-pages/drafts";

/** `settings/infoPages`: everyone reads (the site shows the published copy), staff write (rules). */
function ref() {
  return doc(getDb(), COLLECTIONS.settings, INFO_PAGES_DOC);
}

export function subscribeToInfoPages(onData: (pages: InfoPages) => void, onError: () => void): Unsubscribe {
  try {
    return onSnapshot(
      ref(),
      (snap) => onData(parseInfoPages(snap.exists() ? snap.data() : null, INFO_PAGE_DRAFTS)),
      () => onError()
    );
  } catch {
    onError();
    return () => {};
  }
}

/** Saves the draft only (the site keeps showing the published copy). */
export async function saveInfoPageDraft(id: InfoPageId, draft: InfoPageCopy): Promise<void> {
  await setDoc(ref(), { pages: { [id]: { draft: tidyCopy(id, draft), updatedAt: new Date().toISOString() } } }, { merge: true });
}

/** Saves the draft and shows it on the site. Refused while Hebrew is empty or "[[...]]" is left. */
export async function publishInfoPage(id: InfoPageId, draft: InfoPageCopy): Promise<ReturnType<typeof checkPublish>> {
  const clean = tidyCopy(id, draft);
  const check = checkPublish(id, clean);
  if (!check.ok) return check;
  const now = new Date().toISOString();
  await setDoc(ref(), { pages: { [id]: { draft: clean, published: clean, publishedAt: now, updatedAt: now } } }, { merge: true });
  return check;
}

/** Takes the page off the site (the draft stays). */
export async function unpublishInfoPage(id: InfoPageId): Promise<void> {
  await setDoc(ref(), { pages: { [id]: { published: null, publishedAt: null, updatedAt: new Date().toISOString() } } }, { merge: true });
}
