# coding: utf-8

import errno
import json
import os.path
import time

class RoomLogger(object):

    def __init__(self, directory):
        self.directory = directory
        try:
            os.makedirs(self.directory)
        except OSError as e:
            if e.errno == errno.EEXIST:
                pass
            else:
                raise
        super(RoomLogger, self).__init__()

    def _getCurrentFile(self):
        return os.path.join(self.directory, time.strftime("%Y-%m-%d.json"))

    def _write(self, data):
        with open(self._getCurrentFile(), "a") as f:
            data["time"] = time.time()
            f.write(json.dumps(data) + ",\n")

    def writeNotification(self, user, message):
        return self._write({"user": user, "notification": message})

    def writeMessage(self, user, message):
        return self._write({"user": user, "message": message})
