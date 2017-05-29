import logging
import os
import subprocess
import sys
import time

from PyQt5.QtCore import *
from PyQt5.QtGui import *
from PyQt5.QtNetwork import *
from PyQt5.QtWidgets import *
from PyQt5.QtWebEngineWidgets import QWebEngineView
from PyQt5.QtWebEngineCore import QWebEngineUrlRequestInterceptor

class RenderEngine(object):

    class CustomHeadersRequestInterceptor(QWebEngineUrlRequestInterceptor):

        def __init__(self, *args, **kwargs):
            self.headers = kwargs.pop("headers")
            return QWebEngineUrlRequestInterceptor.__init__(self,
                    *args, **kwargs)

        def interceptRequest(self, info):
            #print "Loading: " + str(info.requestUrl())
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
            height=1200,
            ):
        self.urls = urls
        self.after_render = after_render
        self.postprocess_javascript = postprocess_javascript
        self.cookies = cookies
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

        url, data = self.urls.pop()
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

        view.loadFinished.connect(lambda ok: self.loadFinished(data, view, ok))
        view.load(url)
        view.show()

    def loadFinished(self, data, view, ok):
        if ok:
            if self.postprocess_javascript:
                # loadFinished fires before the page is completely rendered,
                # and there's no renderFinished event. Use QTimer as a hack.
                # TODO(dotdoom): use requestAnimationFrame and console.log in
                #                its callback, which can be intercepted here.
                view.page().runJavaScript(self.postprocess_javascript,
                        lambda arg: QTimer.singleShot(5000,
                            lambda: self.postprocessFinished(data, view, arg)))
            else:
                self.postprocessFinished(data, view, None)
        else:
            self.after_render(data, RuntimeError("Page load has failed"))
            QTimer.singleShot(0, self.renderNext)

    def postprocessFinished(self, data, view, arg):
        if isinstance(arg, basestring):
            self.after_render(data, RuntimeError(arg))
        else:
            size = view.page().contentsSize()
            image = QImage(size.toSize(), QImage.Format_ARGB32)
            image.fill(QColor(255, 0, 0, 0).rgba())
            painter = QPainter(image)
            view.render(painter)
            painter.end()
            view.deleteLater()

            if isinstance(arg, list):
                image = image.copy(*arg)
            buffer = QBuffer()
            image.save(buffer, "png")

            filename = self.after_render(data, None)
            temp_filename = filename + ".tmp"
            try:
                with open(temp_filename, "w") as output:
                    output.write(buffer.buffer().data())
                #subprocess.call([
                #    "optipng",
                #    "-fix",       # error recovery
                #    "-preserve",  # preserve file attributes if possible
                #    "-force",     # force overwriting original file
                #    "-quiet",     # do not talk too much
                #    temp_filename,
                #])
                #subprocess.call([
                #    "convert",
                #    "-trim",
                #    temp_filename,
                #    filename,
                #])
                os.rename(temp_filename, filename)
            finally:
                if os.path.exists(temp_filename):
                    os.remove(temp_filename)

        QTimer.singleShot(0, self.renderNext)
