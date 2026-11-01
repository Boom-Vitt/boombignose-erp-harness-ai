"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { importSheet } from "./actions"

export function ImportForm({ warehouses }: { warehouses: { id: string; name: string; code: string }[] }) {
  const [pending, start] = useTransition()
  const [kind, setKind] = useState("customers")
  const [message, setMessage] = useState("")
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([])

  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const formElement = event.currentTarget
        const form = new FormData(formElement)
        setMessage("")
        setErrors([])
        start(async () => {
          const result = await importSheet(form)
          if (result.errors?.length) {
            setErrors(result.errors)
            setMessage("Nothing was saved.")
            return
          }
          if (result.error) {
            setMessage(result.error)
            return
          }
          setMessage(`Saved ${result.saved ?? 0} rows.`)
          formElement.reset()
        })
      }}
    >
      <label className="block text-sm">
        What to import
        <select className="mt-1 block h-9 w-full rounded-md border bg-background px-2" name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="customers">ลูกค้า / Customers</option>
          <option value="products">สินค้า / Products</option>
          <option value="opening-stock">ยอดยกมา / Opening stock</option>
        </select>
      </label>
      {kind === "opening-stock" ? (
        <label className="block text-sm">
          Warehouse
          <select className="mt-1 block h-9 w-full rounded-md border bg-background px-2" name="warehouseId" required>
            <option value="">Choose a warehouse</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
        </label>
      ) : null}
      <label className="block text-sm">
        CSV or Excel file
        <input className="mt-1 block w-full text-sm" type="file" name="file" accept=".csv,.txt,.xlsx,text/csv" required />
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Import"}</Button>
      {message ? <p role="alert" className="text-sm">{message}</p> : null}
      {errors.length > 0 ? <ul className="space-y-1 text-sm">{errors.slice(0, 20).map((error) => <li key={`${error.row}-${error.message}`}>Row {error.row}: {error.message}</li>)}{errors.length > 20 ? <li>And {errors.length - 20} more.</li> : null}</ul> : null}
    </form>
  )
}
