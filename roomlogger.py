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

    def _get_current_file(self):
        return os.path.join(self.directory, time.strftime("%Y-%m-%d.json"))

    def _write(self, data):
        with open(self._get_current_file(), "a") as f:
            data["time"] = time.time()
            f.write(json.dumps(data) + ",\n")

    def write_notification(self, user, message):
        return self._write({"user": user, "notification": message})

    def write_message(self, user, message):
        return self._write({"user": user, "message": message})
