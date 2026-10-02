# Retrieval evaluation

How well the search finds the passage that holds the answer, measured on a fixed set, so changes to search can be judged by numbers instead of by feel.

Run it with `pnpm eval` (needs `OPENROUTER_API_KEY` and the test database). Every vector is cached in `eval/.embedding-cache.json`, so the first run uses 2 of the 50 free requests a day and every later run uses none. The model that writes answers is not involved: this measures search only.

## What is measured

- **Corpus** (`eval/corpus`): 8 short documents, 6 in English and 1 in Bengali plus an equipment catalog and a policy index (many near-identical lines, the hard case for meaning search). Chunked with size 400 and overlap 60, which gives 36 chunks. The production default is 1000 and 150; a smaller size gives this small corpus enough chunks for ranking to mean something.
- **Questions** (`eval/questions.json`): 14 that the documents answer, in these kinds: paraphrase (different words than the text), exact id (error code, policy number, item number), number, Bengali, and cross-language (Bengali question, English document and the other way round). Each lists the text a correct passage must contain; a few list two acceptable passages. Four more questions are not answerable from the documents.
- **Score**: the rank of the first passage that holds the answer. `hit@1` counts questions where it is first, `hit@3` and `hit@5` where it is in the top 3 and 5. `MRR` is the mean of 1 / rank, so 1.0 means always first.

## Methods compared

| Method | What it does |
| --- | --- |
| `vector` | Embedding search only: the passages closest in meaning. |
| `hybrid-all` | Adds Postgres full-text search on every word of the question, merged with reciprocal rank fusion. |
| `hybrid-ids` | Adds full-text search on the question's identifiers and numbers only (words with a digit), which must all be in the passage. A question in plain words gets no keyword list. This is what the chat uses. |

## Results

Embedding model `nvidia/nemotron-3-embed-1b:free`, 8 documents, 36 chunks, run on 2 Oct 2026.

| | hit@1 | hit@3 | hit@5 | MRR |
| --- | --- | --- | --- | --- |
| vector | 13 / 14 | 14 / 14 | 14 / 14 | 0.964 |
| hybrid-all | 12 / 14 | 13 / 14 | 13 / 14 | 0.901 |
| hybrid-ids | 14 / 14 | 14 / 14 | 14 / 14 | 1.000 |

Only two questions differ between the methods:

- **`policy-17`** ("What does policy SEC-17 say?"): vector search ranks the first chunk of the policy index first, because it is full of "SEC" and "policy", and the chunk with the SEC-17 line second. Searching for the number 17 puts the right chunk first.
- **`en-to-bn`** ("When is the new feature demo?", answered by a Bengali document): vector search finds the Bengali passage first, across languages. Full-text search on all words matches "new", "feature" and "demo" in English documents and pushes the Bengali passage to rank 9. This is why keyword search is limited to identifiers and numbers.

## What these numbers do not show

- The set is small: 14 questions, and `hybrid-ids` beats `vector` on exactly one of them. It says hybrid search does not hurt and can help on ids; it does not say by how much.
- The documents are short and written for the test. Real documents are longer, so there are more passages to confuse.
- It measures finding the passage, not the quality of the written answer.
- The first version of keyword search (all words) was worse than no keyword search. The change to identifiers only was made after seeing that result and the failing questions, so the improvement of `hybrid-ids` over `vector` is measured on questions the change was designed around.

## The "found nothing" threshold

When no passage has a cosine similarity of at least 0.25 with the question, the chat does not call the model and answers "I could not find that in your documents."

On this set the lowest best-similarity of an answerable question is 0.303 and the highest for an unanswerable one is 0.227, so 0.25 sits in the gap, with little room on either side. Re-check it whenever the embedding model or the corpus changes.

| Unanswerable question | Best similarity | Model called? |
| --- | --- | --- |
| What is the capital of France? | 0.058 | no |
| How do I reset my Netflix password? | 0.227 | no |
| Who won the football world cup in 2018? | 0.074 | no |
| বাংলাদেশের রাজধানী কোথায়? | 0.074 | no |
