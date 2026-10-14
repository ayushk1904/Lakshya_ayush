"""RAG pipeline for the Lakshya AI Study Planner.

text_utils      tokenizing + BM25 retrieval
llm             Groq client (JSON mode, rate-limit pacing)
syllabus_ingest indexing: syllabus text -> subjects/units/topics + chunks
pyq_analyzer    past-paper question frequency per topic
plan_builder    request -> retrieval -> priority -> timetable -> strategy
"""
