import os
import subprocess

from PyQt4.QtGui import QApplication
from PyQt4.QtCore import QTimer

from webkit2png import WebkitRenderer

class HTML2PNG(object):

    def __init__(self, cookies=None, user_agent=None, logger=None):
        self.renderer = WebkitRenderer(
                width=1600, height=1200,
                timeout=10, wait=0.4,
                cookies=cookies,
                userAgent=user_agent,
                logger=logger)
        self.devnull = open(os.devnull, 'w')

    def Render(self, url, filename, element_selector=None):
        temp_filename = filename + ".tmp"
        self.renderer.elementSelector = element_selector
        try:
            with open(temp_filename, "w") as output:
                self.renderer.render_to_file(res=url,
                        file_object=output)
            subprocess.call([
                'optipng',
                '-fix',       # error recovery
                '-preserve',  # preserve file attributes if possible
                '-force',     # force overwriting original file
                '-quiet',     # do not talk too much
                temp_filename,
            ])
            os.rename(temp_filename, filename)
        finally:
            if os.path.exists(temp_filename):
                os.remove(temp_filename)

def ApplicationWrapper(callback):
    """HTML2PNG.Render() may only be used from callback"""

    def CallbackWrapper():
        code = 1
        try:
            callback()
            code = 0
        finally:
            QApplication.exit(code)

    QTimer.singleShot(0, CallbackWrapper)
    return QApplication([__name__]).exec_()
