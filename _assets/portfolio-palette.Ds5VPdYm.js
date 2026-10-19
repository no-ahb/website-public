// Runs before the content paints, and again after each client-side navigation.
// The palette data belongs to the destination page; the script can be cached once.
(() => {
  const isDetail = document.body.dataset.fieldDetail === 'true';
  const palettes = JSON.parse(document.body.dataset.fieldPalettes);
  const key = isDetail ? 'portfolio-field:' + location.pathname : 'portfolio-home-palette';
  let previous = -1;
  try { previous = Number(sessionStorage.getItem(key) ?? -1); } catch {}
  const validPrevious = previous >= 0 && previous < palettes.length;
  let index = Math.floor(Math.random() * (palettes.length - (validPrevious ? 1 : 0)));
  if (validPrevious && index >= previous) index++;
  if (!isDetail && document.body.dataset.fieldCarried && validPrevious) index = previous;
  document.body.dataset[isDetail ? 'fieldPair' : 'homePalette'] = String(index);
  try { sessionStorage.setItem(key, String(index)); } catch {}
  if (!document.body.dataset.fieldCarried) {
    document.body.dataset.initialGround = palettes[index][0];
    document.body.style.setProperty('--view-ground', palettes[index][0]);
    document.documentElement.style.setProperty('--view-ground', palettes[index][0]);
  }
})();
