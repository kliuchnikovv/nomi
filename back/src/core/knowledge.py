"""Project-scoped knowledge retrieval.

Vectors in `personal_vectors` always carry a `user_id`; project documents
additionally carry a `project_id`. A project chat must retrieve
    (this project's documents) ∪ (the user's general knowledge)
while NOT leaking other projects' documents. PgVector filters are AND-equality
only, so this OR semantics cannot be expressed as a single filter. We implement
it here by popping `project_id` from the incoming filters, searching with the
remaining filters (over-fetching), then post-filtering the hits in Python.
"""

import logging

from agno.knowledge import Knowledge

logger = logging.getLogger(__name__)

# Search this many times the requested limit before post-filtering, so dropping
# other-project hits still leaves enough results.
_OVERFETCH = 4
_DEFAULT_LIMIT = 10


class ProjectAwareKnowledge(Knowledge):
    """Knowledge subclass implementing project-scoped union retrieval.

    - When `project_id` is present in the filters (project chat): keep hits that
      have no `project_id` (general knowledge) OR whose `project_id` matches;
      drop hits belonging to other projects.
    - When the filters are a dict WITHOUT `project_id` (general chat): drop all
      project-scoped hits so project documents never surface outside their
      project.
    - For non-dict filters (None / FilterExpr list), behave like the base class.
    """

    def _split_project_filter(self, filters):
        """Returns (rest_filters, active_project_id, exclude_all_projects)."""
        if not isinstance(filters, dict):
            return filters, None, False
        if "project_id" not in filters:
            return filters, None, True
        rest = {k: v for k, v in filters.items() if k != "project_id"}
        return rest, filters.get("project_id"), False

    def _post_filter(self, docs, active_pid, exclude_all, limit):
        out = []
        for d in docs:
            meta = getattr(d, "meta_data", None) or {}
            doc_pid = meta.get("project_id")
            if doc_pid in (None, ""):
                out.append(d)  # general knowledge is always allowed
            elif (
                not exclude_all
                and active_pid is not None
                and str(doc_pid) == str(active_pid)
            ):
                out.append(d)  # this project's documents
            # otherwise the hit belongs to another project -> drop it
        return out[:limit] if limit else out

    def search(self, query, max_results=None, filters=None, search_type=None):
        rest, active_pid, exclude_all = self._split_project_filter(filters)
        limit = max_results or self.max_results or _DEFAULT_LIMIT
        docs = super().search(
            query=query,
            max_results=limit * _OVERFETCH,
            filters=rest,
            search_type=search_type,
        )
        return self._post_filter(docs, active_pid, exclude_all, limit)

    async def asearch(self, query, max_results=None, filters=None, search_type=None):
        rest, active_pid, exclude_all = self._split_project_filter(filters)
        limit = max_results or self.max_results or _DEFAULT_LIMIT
        docs = await super().asearch(
            query=query,
            max_results=limit * _OVERFETCH,
            filters=rest,
            search_type=search_type,
        )
        return self._post_filter(docs, active_pid, exclude_all, limit)
