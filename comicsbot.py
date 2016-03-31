# coding: utf-8

import httplib
import time
import traceback
import urllib
import xmlrpclib

from jabberbot import JabberBot, botcmd

class MUCJabberBot(JabberBot):

    def __init__(self, *args, **kwargs):
        self.room_nicknames = {}
        self.prefix = "!"
        self.room_logger = kwargs["room_logger"]
        del kwargs["room_logger"]
        super(MUCJabberBot, self).__init__(*args, **kwargs)

    def callback_message(self, conn, msg):
        # Delayed messages are those that come from groupchat history.
        # Avoid reacting on history messages.
        if msg.getTag("delay", namespace="urn:xmpp:delay"):
            return

        message = msg.getBody()
        if not message:
            return

        if (msg.getFrom().getStripped() in self.room_nicknames and
                msg.getType() == "groupchat"):
            # One logger for all rooms, oh no!
            self.room_logger.writeMessage(msg.getFrom().getResource(),
                    message)

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

    def callback_presence(self, conn, pr):
        if pr.getFrom().getStripped() in self.room_nicknames:
            if pr.getType() == "unavailable":
                text = "left the room"
            elif pr.getShow() is None:
                text = "is online"
            else:
                text = "is %s" % pr.getShow()
            if pr.getStatus() is not None:
                text += ": " + pr.getStatus()
            self.room_logger.writeNotification(pr.getFrom().getResource(),
                    text)
        return super(MUCJabberBot, self).callback_presence(conn, pr)

    def join_room(self, chatroom, nickname, *args, **kwargs):
        # Store nickname in each room to fetch direct replies
        self.room_nicknames[chatroom] = nickname
        return super(MUCJabberBot, self).join_room(chatroom, nickname)

    def build_reply(self, msg, text, private=False):
        # Prepend text with sender's nickname if in a groupchat
        if not private:
            text = "%s: %s" % (msg.getFrom().getResource(), text)
        return super(MUCJabberBot, self).build_reply(msg, text, private)

    TEXT_LIMIT_PER_MESSAGE = 1000
    TEXT_LIMIT_SUFFIX = ' [...]'
    TEXT_LIMIT_WAIT_SECONDS = 5

    def send(self, user, text, in_reply_to=None, message_type='chat'):
        if text:
            while len(text) > self.TEXT_LIMIT_PER_MESSAGE:
                chunk = (
                        text[:self.TEXT_LIMIT_PER_MESSAGE -
                            len(self.TEXT_LIMIT_SUFFIX)] +
                        self.TEXT_LIMIT_SUFFIX)
                text = text[len(chunk):]
                super(MUCJabberBot, self).send(user, chunk, in_reply_to,
                        message_type)
                time.sleep(self.TEXT_LIMIT_WAIT_SECONDS)
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

TIME_SPAN_SUFFIXES = {
    "s": 1,
    "m": 60,
    "h": 60 * 60,
    "d": 60 * 60 * 24,
    "w": 60 * 60 * 24 * 7,
}

def ParseTimeSpanToSeconds(s, default=None):
    if not s:
        return default
    if any(s.endswith(prefix) for prefix in TIME_SPAN_SUFFIXES):
        return float(s[:-1]) * TIME_SPAN_SUFFIXES[s[-1]]
    return float(s)

class ComicsBot(MUCJabberBot):

    def __init__(self, *args, **kwargs):
        self.wiki = kwargs['wiki']
        del kwargs['wiki']
        super(ComicsBot, self).__init__(*args, **kwargs)

    @wikicmd
    def recent(self, msg, args):
        """Show recent changes for interval (default=1d)."""
        timespan = ParseTimeSpanToSeconds(args, 24 * 60 * 60)
        return "\n".join([
            "%(name)s modified by %(author)s at %(lastModified)s" % page
            for page in self.wiki.wiki.getRecentChanges(
                int(time.time() - timespan))])
        #self.send_simple_reply(msg, str(recent_changes))

    @wikicmd
    def stats(self, msg, args):
        return "no stats (yet)"

    @botcmd(name="log")
    def get_log_url(self, msg, args):
        return "http://log.%s/#search=%s" % (self.jid.getDomain(),
                urllib.quote(args.encode('utf8')))

    @botcmd(name="logs")
    def get_log_url2(self, msg, args):
        return self.get_log_url(msg, args)
