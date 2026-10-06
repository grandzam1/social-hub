Stores named secrets and settings encrypted per project, with a fallback to the "global" project.
Exposes getConnection, setConnection, deleteConnection, listConnections, and clearConnectionsCache.
Needs a D1 binding named DB and a Worker secret named MASTER_KEY.
