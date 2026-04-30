// compactor: a context compaction layer
// it should let the model avoid loading the entire context into memory
// and instead keep artifacts externally, passing references or equivalent handles
// from external storage with fast search (mem0, etc.)
// while accounting for the fact that the agent starts locally as one application
// and must restore its full stack quickly.
//
// the compactor should operate as a separate prompt layer.
