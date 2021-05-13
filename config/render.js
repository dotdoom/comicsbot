// This function runs inside a browser page. DOM is accessible here. The
// function should return a DOMRect JSON - a clipping rectagle which will be
// captured as a screenshot, or any other object with "x", "y", "width" and
// "height" properties.
exports.findRect = () => {
  const selectors = [
    'div.ct-container',
    'div.fn-container',
    'img.media',
  ];

  for (const selector of selectors) {
    for (const container of document.querySelectorAll(selector)) {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return rect.toJSON();
      }
    }
  }

  throw 'Unable to find any image at ' + window.location.href;
};
