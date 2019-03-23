// List of root namespaces to search for pages.
exports.searchNamespaces = [
  'ru',
];

// Turn page ID into path of a URL, or return null if we don't want this page.
exports.pageURLPath = (id) => {
  // id is in the form "ru:sci-fi:freefall:0001".
  if (/:[0-9]+$/.test(id)) {
    // If last part of id is only digits, turn id into
    // "ru/sci-fi/freefall/0001?do=export_xhtml"
    // which is a valid path of a DokuWiki URL.
    return id.replace(/:/g, '/') + '?do=export_xhtml';
  }

  // If we don't want this page, return null.
  return null;
};

// This function is special because it runs *not* in the bot, but inside a page
// itself. DOM is accessible within this method. It returns an Object:
//   {
//     [screenshotPath]: DOMRectJSON,
//     [screenshotPath]: DOMRectJSON,
//     ...
//   ]
// where screenshotPath is a path to save screenshot to, and DOMRectJSON is a
// clipping rect with "x", "y", "width" and "height" properties. Since this
// function returns an Object, we can save multiple screenshots from a single
// page.
exports.findBoxes = (id) => {
  // id is in the form "ru:sci-fi:freefall:0001". Since "*" is greedy, it will
  // capture all parts except the last.
  const match = id.match(/^(.*):(.*)$/);

  // turn "ru:sci-fi:freefall" into "ru/sci-fi/freefall/u/" which is a path on
  // filesystem to store screenshot.
  const screenshotDirectory = match[1].replace(/:/g, '/') + '/u/';
  // screenshotFilename will be "0001.png".
  const screenshotFilename = screenshotDirectory + match[2] + '.png';

  const container =
    document.querySelector('div.ct-container') ||
    document.querySelector('div.fn-container');
  if (container) {
    // Render only container.
    const rect = container.getBoundingClientRect();
    return {
      [screenshotFilename]: rect.toJSON(),
    };
  }

  throw 'Unable to find any image on page ' + id;
}
