// List of root namespaces to search for pages.
exports.searchNamespaces = [
  'ru',
];

// Turn page ID into path of a URL, or return null if we don't want this page.
exports.pagePath = (id) => {
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

// This function is special because it runs not in the bot, but inside a page
// itself. DOM is accessible within this method. It returns a list of lists:
//   [
//     [x1, y1, width1, height1, path1],
//     [x2, y2, width2, height2, path2],
//     ...
//   ]
// where path is a path to save screenshot to, and the rest is a bounding rect.
// Since this function returns a list, it can save multiple screenshots from a
// single page.
exports.findBoxes = (id) => {
  // id is in the form "ru:sci-fi:freefall:0001". Since "*" is greedy, it will
  // capture all parts except the last.
  const match = id.match(/^(.*):(.*)$/);

  // turn "ru:sci-fi:freefall" into "ru/sci-fi/freefall" which is a path on
  // filesystem to store screenshot.
  const path = match[1].replace(/:/g, '/');
  // filename will be "0001.png".
  const filename = match[2] + '.png';
  const screenshotFileName = path + '/u/' + filename;

  const container =
    document.querySelector('div.ct-container') ||
    document.querySelector('div.fn-container');
  if (container) {
    // Render only container.
    const rect = container.getBoundingClientRect();
    return [
      [rect.x, rect.y, rect.width, rect.height, screenshotFileName],
    ];
  } else {
    // As a fallback, render full page.
    return [screenshotFileName];
  }
}
