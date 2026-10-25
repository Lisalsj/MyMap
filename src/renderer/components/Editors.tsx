import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MapPin, Search } from 'lucide-react'
import type { City, Place, Trip, TripInput, Visit, VisitInput } from '../../shared/types'
import { buildVisitInput, type CitySelection } from '../model'
import { Modal, Spinner } from './Common'

export function TripEditor({
  trip,
  onClose,
  onSave
}: {
  trip?: Trip
  onClose: () => void
  onSave: (input: TripInput) => Promise<void>
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    try {
      await onSave({
        ...trip,
        title: String(f.get('title')).trim(),
        startDate: String(f.get('startDate')),
        endDate: String(f.get('endDate')),
        description: String(f.get('description')),
        tags: String(f.get('tags'))
          .split(/[,，、]/)
          .map((t) => t.trim())
          .filter(Boolean)
      })
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={trip ? '编辑这段旅行' : '一段新的旅程'}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form onSubmit={submit} className="form">
        <p className="form-intro">把期待写下来，故事就从这里开始。</p>
        <label>
          旅行名称
          <input
            name="title"
            placeholder="例如：去大理，过几天慢日子"
            defaultValue={trip?.title}
            required
            maxLength={160}
          />
        </label>
        <div className="form-row">
          <label>
            出发日期 <span>可选</span>
            <input type="date" name="startDate" defaultValue={trip?.startDate} />
          </label>
          <label>
            归来日期 <span>可选</span>
            <input type="date" name="endDate" defaultValue={trip?.endDate} />
          </label>
        </div>
        <label>
          旅行标签
          <input
            name="tags"
            defaultValue={trip?.tags.join('，')}
            placeholder="山野、和朋友、周末出逃（用逗号分隔）"
          />
        </label>
        <label>
          旅行寄语
          <textarea
            name="description"
            defaultValue={trip?.description}
            placeholder="有什么想去的地方，或值得记住的心情？"
            rows={4}
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy && <Spinner />}
            {trip ? '保存修改' : '创建旅行'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export interface InitialVisit {
  visit: Visit
  place: Place
}
export function VisitEditor({
  tripId,
  coordinates,
  initial,
  onClose,
  onSave
}: {
  tripId: string
  coordinates?: [number, number]
  initial?: InitialVisit
  onClose: () => void
  onSave: (input: VisitInput) => Promise<void>
}) {
  const place = initial?.place,
    visit = initial?.visit
  const [query, setQuery] = useState(place?.cityName || ''),
    [cities, setCities] = useState<City[]>([])
  const [city, setCity] = useState<CitySelection | null>(
    place?.cityId
      ? { id: place.cityId, name: place.cityName, country: place.country, lat: place.lat, lon: place.lon }
      : null
  )
  const [manual, setManual] = useState(place?.cityId.startsWith('manual:') || false),
    [manualCityName, setManualCityName] = useState(place?.cityName || ''),
    [manualCountry, setManualCountry] = useState(place?.country || '')
  const [kind, setKind] = useState<VisitInput['kind']>(place?.kind || 'city'),
    [name, setName] = useState(place?.name || '')
  const [lat, setLat] = useState(String(coordinates?.[0] ?? place?.lat ?? '')),
    [lon, setLon] = useState(String(coordinates?.[1] ?? place?.lon ?? ''))
  const [date, setDate] = useState(visit?.date || ''),
    [note, setNote] = useState(visit?.note || '')
  const [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [error, setError] = useState(''),
    [searchError, setSearchError] = useState('')
  const request = useRef(0)
  useEffect(() => {
    if (manual) {
      request.current++
      setSearching(false)
      return
    }
    const id = ++request.current
    setSearching(true)
    const timer = setTimeout(() => {
      window.myMap
        .cities(query)
        .then((list) => {
          if (id === request.current) {
            setCities(list)
            setSearchError('')
          }
        })
        .catch((e) => {
          if (id === request.current) setSearchError(String(e))
        })
        .finally(() => {
          if (id === request.current) setSearching(false)
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      request.current++
    }
  }, [query, manual])
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    try {
      const input = buildVisitInput({
        id: visit?.id,
        tripId,
        kind,
        name,
        manual,
        manualCityName,
        manualCountry,
        city,
        lat,
        lon,
        date,
        note
      })
      setBusy(true)
      await onSave(input)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const clearCity = () => {
    setCity(null)
    setManualCityName('')
    setManualCountry('')
    setQuery('')
  }
  const selectedCity = manual ? manualCityName.trim() : city?.name
  const center = kind === 'city' && !manual ? city : null
  return (
    <Modal
      title={initial ? '编辑这条足迹' : '把一个地方，放进回忆'}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form className="form" onSubmit={submit}>
        <div className="segmented">
          {(['city', 'scenic', 'custom'] as const).map((k, i) => (
            <button type="button" key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {['到访城市', '景点 / 地标', '自定义地点'][i]}
            </button>
          ))}
        </div>
        <div className="section-title">
          <span className="section-label">所属城市{kind !== 'city' ? ' · 可选' : ''}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setManual(!manual)
              setSearchError('')
              setError('')
            }}
          >
            {manual ? '返回城市搜索' : '手动填写城市'}
          </button>
        </div>
        {manual ? (
          <div className="form-row">
            <label>
              城市名称
              <input
                aria-label="手动城市名称"
                value={manualCityName}
                onChange={(e) => setManualCityName(e.target.value)}
                required={kind === 'city'}
                placeholder="例如：一个还没被收录的小城"
                maxLength={160}
              />
            </label>
            <label>
              国家 / 地区 <span>可选</span>
              <input
                aria-label="手动国家或地区"
                value={manualCountry}
                onChange={(e) => setManualCountry(e.target.value)}
                placeholder="例如：中国"
                maxLength={100}
              />
            </label>
          </div>
        ) : (
          <>
            <label>
              <div className="input-icon">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setCity(null)
                  }}
                  placeholder="搜索城市，中英文均可"
                  aria-label="搜索所属城市"
                />
              </div>
            </label>
            <div className="city-results">
              {searching ? (
                <span className="muted">
                  <Spinner /> 正在搜索城市
                </span>
              ) : (
                cities.slice(0, 10).map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={city?.id === c.id ? 'selected' : ''}
                    onClick={() => {
                      setCity(c)
                      setError('')
                      if (kind === 'city') {
                        setLat('')
                        setLon('')
                      }
                    }}
                  >
                    <MapPin size={14} />
                    <span>
                      {c.name}
                      <small>
                        {c.region} · {c.country}
                      </small>
                    </span>
                    {city?.id === c.id && <b>已选择</b>}
                  </button>
                ))
              )}
              {!searching && !cities.length && (
                <p className="muted">
                  没有匹配城市，可以使用“手动填写城市”。景点与自定义地点也可暂不选择城市。
                </p>
              )}
            </div>
            {searchError && (
              <p className="inline-error" role="alert">
                {searchError} · 也可以手动填写城市。
              </p>
            )}
          </>
        )}
        {manual && <p className="muted">填写国家或地区，有助于在地图上点亮城市；不确定也可以先保存。</p>}
        {selectedCity && (
          <div className="section-title">
            <p className="selected-city">
              已选：{selectedCity}
              {(manual ? manualCountry : city?.country) ? ` · ${manual ? manualCountry : city?.country}` : ''}
            </p>
            {kind !== 'city' && (
              <button type="button" className="text-button" onClick={clearCity}>
                暂不关联城市
              </button>
            )}
          </div>
        )}
        {kind !== 'city' && (
          <>
            <label>
              地点名称
              <input
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="例如：洱海边的一棵树"
                maxLength={160}
              />
            </label>
            {!selectedCity && (
              <p className="muted">
                先记下这个地方。未关联城市的地点，会作为自定义足迹保存，暂不生成城市印章。
              </p>
            )}
          </>
        )}
        <div className="form-row">
          <label>
            纬度 <span>可选</span>
            <input
              name="lat"
              type="number"
              step="any"
              min="-90"
              max="90"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder={
                center?.lat !== null && center?.lat !== undefined ? String(center.lat) : '留空也能记下回忆'
              }
            />
          </label>
          <label>
            经度 <span>可选</span>
            <input
              name="lon"
              type="number"
              step="any"
              min="-180"
              max="180"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              placeholder={
                center?.lon !== null && center?.lon !== undefined ? String(center.lon) : '可在地图上点选'
              }
            />
          </label>
        </div>
        <label>
          到访日期 <span>可选</span>
          <input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          一句话回忆
          <textarea
            name="note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="那天的风、同行的人……"
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy && <Spinner />}
            {initial ? '保存修改' : '保存到访'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
