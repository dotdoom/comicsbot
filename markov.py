# coding: utf-8

import markovify
import traceback

class MarkovChain(object):

    def __init__(self, file_name):
        self._file_name = file_name
        self._model = None
        super(MarkovChain, self).__init__()

    def Add(self, message):
        try:
            model = markovify.NewlineText(message)
            self.Merge(model)
        except:
            traceback.print_exc()

    def Merge(self, model):
        if self._model is None:
            try:
                with open(self._file_name, "r") as f:
                    self._model = markovify.NewlineText.from_chain(f.read())
            except:
                traceback.print_exc()

        if self._model is None:
            self._model = model
        else:
            self._model = markovify.combine([self._model, model])

        with open(self.markov_file, "w") as f:
            f.write(self.markov.chain.to_json())

    def Get(self, max_length=200):
        reply = ''
        if self.markov is not None:
            try:
                for i in xrange(10):
                    new_reply = self.markov.make_short_sentence(max_length,
                            tries=100)
                    if (new_reply is not None) and (len(new_reply) > len(reply)):
                        reply = new_reply
            except:
                traceback.print_exc()
        return reply
