PROBE

An app to improve recall and do periodic recall exercises on the topics that have been learned.

It will be used for note-taking. After each note is saved, the LLM will create concept objects and save them to the json database. Each concept has a periodic quiz session and a confidence score. The quizzes should attack the concept from different angles. Some of the concepts might be hard to generate questions for, especially the ones that require advanced calculations. For those concepts, there should be a way to get questions (probably online) with solutions/answers, and it should ask those questions.

Different fields require different kinds of quizzes. For example, to memorize vocabulary, questions will be simple flash cards. To recall scientific concepts, quizzes that deepen the understanding and touch the real comprehension points are better. If the science is more of an engineering topic, quizzes as problems that require calculations are also necessary. On the other hand, if the science is more of a social science, it is better to ask to write a paragraph about the concept or give insights on an open-ended question.

So whenever a note is taken by the user, the app should categorize them into memorization, engineering, social…

After each quiz session, the user will be asked about his/her confidence in the answer. This will partially feed the confidence score of the concept object.

It will have both light and dark designs with a customizable second color for details. The main page will be a list of notes and a button to create new notes. Also, selecting a note from the list will open the editor for that note, so appending to notes, continuing to write an old one, is possible. In that case, the model will update the concept object by adding the new information too.

There will be a secondary page for quizzes. Before generating a quiz, the model will update the confidence scores based on the time value. So there is no assumption that every day will be a quiz day. The user will come up with a pace of his/her own. The confidence decay will be affected by how many times that concept is recalled and how well the scores of those past quizzes are.

There will be a third page for mapping the concepts. Each concept will be a bubble and connected to other concept/concepts (if possible, some of them can just stand alone). The user will be able to freely move them, remove the connections, or create new connections. This is not a tree-like structure; it will be a free-form graph, so everything can be connected to anything. Connections will also have some sort of strength value based on how strong the connection between those two concepts is.

OpenAI API will be used to categorize and save notes and to create quizzes. The API key will be provided in the .env file.
