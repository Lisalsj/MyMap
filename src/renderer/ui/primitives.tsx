export function PageSkeleton() {
  return (
    <div className="page-skeleton" role="status" aria-label="正在打开页面">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel" />
      </div>
      <span className="sr-only">正在打开页面</span>
    </div>
  )
}
