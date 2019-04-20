// This function runs inside a browser page. DOM is accessible here. The
// function should return a DOMRect JSON - a clipping rectagle which will be
// captured as a screenshot, or any other object with "x", "y", "width" and
// "height" properties.
exports.findRect = () => {
  const container =
    document.querySelector('div.ct-container') ||
    document.querySelector('div.fn-container');
  if (container) {
    return container.getBoundingClientRect().toJSON();
  }

  throw 'Unable to find any image!';
}
