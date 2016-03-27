# coding: utf-8

import httplib
import time
import traceback
import xmlrpclib

from jabberbot import JabberBot, botcmd

class MUCJabberBot(JabberBot):

    def __init__(self, *args, **kwargs):
        self.room_nicknames = {}
        self.prefix = "!"
        super(MUCJabberBot, self).__init__(*args, **kwargs)

    def callback_message(self, conn, msg):
        # Delayed messages are those that come from groupchat history.
        # Avoid reacting on history messages.
        if msg.getTag("delay", namespace="urn:xmpp:delay"):
            return

        message = msg.getBody()
        if not message:
            return

        if message.startswith(self.prefix):
            msg.setBody(message[len(self.prefix):])
        else:
            room = msg.getFrom().getStripped()
            if room in self.room_nicknames:
                # Only process messages started with bot's nickname
                nickname = self.room_nicknames[room]
                if message.startswith(nickname):
                    msg.setBody(message[len(nickname)+1:].strip())
                else:
                    return
        return super(MUCJabberBot, self).callback_message(conn, msg)

    def join_room(self, chatroom, nickname, *args, **kwargs):
        # Store nickname in each room to fetch direct replies
        self.room_nicknames[chatroom] = nickname
        return super(MUCJabberBot, self).join_room(chatroom, nickname)

    def build_reply(self, msg, text, private=False):
        # Prepent text with sender's nickname if in a groupchat
        if not private:
            text = "%s: %s" % (msg.getFrom().getResource(), text)
        return super(MUCJabberBot, self).build_reply(msg, text, private)

    SINGLE_TEXT_BLOB_LIMIT = 20000
    TEXT_TO_BE_CONTINUED = ' [...]'
    TEXT_WAIT_CHUNK_SECONDS = 5

    def send(self, user, text, in_reply_to=None, message_type='chat'):
        if text and len(text) > self.SINGLE_TEXT_BLOB_LIMIT:
            while 1:
                chunk = (
                        text[:self.SINGLE_TEXT_BLOB_LIMIT-
                            len(self.TEXT_TO_BE_CONTINUED)] +
                        TEXT_TO_BE_CONTINUED)
                text = text[len(chunk):]
                super(MUCJabberBot, self).send(user, chunk, in_reply_to,
                        message_type)
                time.sleep(self.TEXT_WAIT_CHUNK_SECONDS)
                if len(text) <= self.SINGLE_TEXT_BLOB_LIMIT:
                    break
        return super(MUCJabberBot, self).send(user, text, in_reply_to,
                message_type)


    @botcmd
    def test(self, msg, args):
        """Replies with 'passed' if it can."""
        return "passed"

def wikicmd(func):
    @botcmd(name=func.__name__)
    def decorated(*args, **kwargs):
        if args[0].wiki is None:
            return "This command is not available when not connected to wiki"
        try:
            ret = func(*args, **kwargs)
        except ValueError as e:
            ret = "Cannot understand the value specified"
        except httplib.HTTPException as e:
            ret = "[wiki] HTTP Error"
            traceback.print_exc()
        except xmlrpclib.ProtocolError as e:
            ret = "[wiki] Protocol Error: " + str(e.errmsg)
        except xmlrpclib.Fault as e:
            ret = "[wiki] Fault: " + str(e.faultString)
        except xmlrpclib.Error as e:
            ret = "[wiki] Unknown Error: " + str(e.message)
        return ret
    decorated.__doc__ = func.__doc__
    return decorated

def ParseTimeSpanToSeconds(s, default=None):
    if s.endswith("s"):
        return int(s[:-1])
    elif s.endswith("m"):
        return int(s[:-1]) * 60
    elif s.endswith("h"):
        return int(s[:-1]) * 60 * 60
    elif s.endswith("d"):
        return int(s[:-1]) * 60 * 60 * 24
    elif s.endswith("w"):
        return int(s[:-1]) * 60 * 60 * 24 * 7
    elif s:
        return int(s)
    else:
        return default

class ComicsBot(MUCJabberBot):

    def __init__(self, *args, **kwargs):
        self.wiki = kwargs['wiki']
        del kwargs['wiki']
        super(ComicsBot, self).__init__(*args, **kwargs)

    @wikicmd
    def recent(self, msg, args):
        """Show recent changes for interval (default=1d)."""
        timespan = ParseTimeSpanToSeconds(args, 24 * 60 * 60)
        return "\n".join(["%(name)s modified by %(author)s at %(lastModified)s" % page
            for page in self.wiki.wiki.getRecentChanges(int(time.time() - timespan))])
        #self.send_simple_reply(msg, str(recent_changes))

    @wikicmd
    def stats(self, msg, args):
        return "no stats (yet)"
