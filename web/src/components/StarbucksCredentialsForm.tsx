import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SecurityQuestion {
  question: string
  answer: string
}

export interface CredentialsFormData {
  username: string
  password: string
  security_questions: SecurityQuestion[]
}

interface Props {
  onSubmit: (data: CredentialsFormData) => Promise<void>
  submitLabel: string
  submittingLabel?: string
  error?: string
  defaults?: Partial<CredentialsFormData>
}

export default function StarbucksCredentialsForm({ onSubmit, submitLabel, submittingLabel, error, defaults }: Props) {
  const [username, setUsername] = useState(defaults?.username ?? '')
  const [password, setPassword] = useState(defaults?.password ?? '')
  const [questions, setQuestions] = useState<SecurityQuestion[]>(
    defaults?.security_questions ?? [{ question: '', answer: '' }]
  )
  const [submitting, setSubmitting] = useState(false)

  const updateQuestion = (i: number, field: keyof SecurityQuestion, value: string) =>
    setQuestions(prev => prev.map((q, j) => j === i ? { ...q, [field]: value } : q))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit({ username, password, security_questions: questions })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Global Username</Label>
        <Input placeholder="US12345678" value={username} onChange={e => setUsername(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label>Password</Label>
        <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
      </div>
      <div className="space-y-3">
        <div>
          <Label>Security Questions</Label>
          <p className="text-sm text-muted-foreground mt-1">
            Add a keyword from each security question and its answer.
          </p>
        </div>
        {questions.map((q, i) => (
          <div key={i} className="flex gap-2">
            <Input
              placeholder="Keyword (e.g. game, born)"
              value={q.question}
              onChange={e => updateQuestion(i, 'question', e.target.value)}
              required
              className="flex-1"
            />
            <Input
              placeholder="Answer"
              value={q.answer}
              onChange={e => updateQuestion(i, 'answer', e.target.value)}
              required
              className="flex-1"
            />
            {questions.length > 1 && (
              <Button type="button" variant="ghost" size="sm"
                onClick={() => setQuestions(p => p.filter((_, j) => j !== i))}>
                ✕
              </Button>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm"
          onClick={() => setQuestions(p => [...p, { question: '', answer: '' }])}>
          + Add question
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? (submittingLabel ?? 'Saving...') : submitLabel}
      </Button>
    </form>
  )
}
