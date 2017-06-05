import logging
import sys

from PyQt5.QtCore import *
from PyQt5.QtGui import *
from PyQt5.QtNetwork import *
from PyQt5.QtWebEngineCore import QWebEngineUrlRequestInterceptor
from PyQt5.QtWebEngineWidgets import QWebEngineView
from PyQt5.QtWidgets import *

logger = logging.getLogger(__name__)

class RenderEngine(object):

    class CustomHeadersRequestInterceptor(QWebEngineUrlRequestInterceptor):

        def __init__(self, *args, **kwargs):
            self.headers = kwargs.pop("headers")
            return QWebEngineUrlRequestInterceptor.__init__(self,
                    *args, **kwargs)

        def interceptRequest(self, info):
            logger.debug("Loading: %s", info.requestUrl())
            for header in self.headers:
                info.setHttpHeader(*header)

    def __init__(self,
            urls,
            after_render=lambda url, e: sys.stderr.write("%s: %s\n" % (url, e or "ok")) or "output.png",
            postprocess_javascript=None,
            cookies=None,
            headers=None,
            simultaneous_urls=10,
            width=2000,
            height=4000,
            ):
        self.urls = urls
        self.after_render = after_render
        self.postprocess_javascript = postprocess_javascript
        self.cookies = cookies
        # TODO(dotdoom): ignore width/height. Resize to contentsSize when we
        #                have the page rendered (then wait for the next render
        #                using JavaScript workaround mentioned below).
        self.width = width
        self.height = height

        self.requestInterceptor = None
        if headers:
            self.requestInterceptor = self.CustomHeadersRequestInterceptor(
                    headers=headers)

        self.app = QApplication(sys.argv)
        for i in xrange(simultaneous_urls):
            QTimer.singleShot(0, self.renderNext)
        self.running_workers = simultaneous_urls

    def Run(self):
        return self.app.exec_()

    def renderNext(self):
        if len(self.urls) == 0:
            self.running_workers -= 1
            if self.running_workers == 0:
                self.app.exit(0)
            return

        url, user_data = self.urls.pop(0)
        url = QUrl(url)

        view = QWebEngineView()
        view.resize(self.width, self.height)

        if self.cookies:
            baseUrl = QUrl(url)
            baseUrl.setPath("/")
            for cookie in self.cookies:
                view.page().profile().cookieStore().setCookie(
                        QNetworkCookie(*cookie),
                        baseUrl,
                )

        if self.requestInterceptor:
            view.page().profile().setRequestInterceptor(self.requestInterceptor)

        view.loadFinished.connect(
                lambda ok: self.loadFinished(user_data, view, ok))
        view.load(url)
        view.show()

    def loadFinished(self, user_data, view, ok):
        if ok:
            if self.postprocess_javascript:
                # loadFinished fires before the page is completely rendered,
                # and there's no renderFinished event. Use QTimer as a hack.
                # TODO(dotdoom): use requestAnimationFrame and console.log in
                #                its callback, which can be intercepted here.
                view.page().runJavaScript(self.postprocess_javascript,
                        lambda js_result: QTimer.singleShot(5000,
                            lambda: self.postprocessFinished(user_data, view,
                                js_result)))
            else:
                self.postprocessFinished(user_data, view, None)
        else:
            self.after_render(user_data, RuntimeError("Page load has failed"))
            QTimer.singleShot(0, self.renderNext)

    def postprocessFinished(self, user_data, view, js_result):
        if isinstance(js_result, basestring):
            self.after_render(user_data, RuntimeError(js_result))
        else:
            # contentsSize() is a QRectF (float metrics)
            size = view.page().contentsSize().toSize()
            if size.width() > self.width or size.height() > self.height:
                logger.error(
                        "Page contents (%dx%d) do not fit into widget (%dx%d), "
                        "contents may be cropped", size.width(), size.height(),
                        self.width, self.height)
                self.after_render(user_data,
                        RuntimeError("Widget is too small"))
            else:
                if isinstance(js_result, list):
                    rect = QRect(*js_result)
                    size = rect.size()
                    region = QRegion(rect)
                    del rect
                else:
                    rect = QRect()
                    rect.setSize(size)
                    region = QRegion(rect)
                    del rect

                image = QImage(size, QImage.Format_ARGB32)
                image.fill(QColor(255, 0, 0, 0).rgba())
                painter = QPainter(image)
                view.render(painter, QPoint(), region)
                painter.end()
                buffer = QBuffer()
                image.save(buffer, "png")

                self.after_render(user_data, buffer.buffer().data())

        # This is important. Holding this object might be not a big deal for Python,
        # but it also keeps a Chromium renderer instance running.
        view.deleteLater()
        QTimer.singleShot(0, self.renderNext)
