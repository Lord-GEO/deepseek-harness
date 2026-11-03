/** Confirmation for permanent Session-history deletion. */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionDeleteDialogProps } from '../contract/slots.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/**
 * Show the captured deletion target in the application overlay.
 * @param props - pending target, deletion callback, and locale.
 * @returns confirmation while a target is pending, otherwise null.
 */
export function SessionDeleteDialog(props: SessionDeleteDialogProps) {
  const request = props.useDeleteRequest(value => value)
  if (request === null) return null
  return <DeleteForm key={request.sessionId} {...props} request={request} />
}

function DeleteForm({ request, deleteSession, settleSessionDelete, t }: SessionDeleteDialogProps & {
  request: { sessionId: Parameters<SessionDeleteDialogProps['deleteSession']>[0]; displayTitle: string }
}) {
  const [pending, setPending] = useState(false)
  const close = () => { if (!pending) settleSessionDelete() }
  const confirm = () => {
    if (pending) return
    setPending(true)
    deleteSession(request.sessionId).then(settleSessionDelete).catch((error: unknown) => {
      // The owning action reports failure through the application toast.
      console.warn('session deletion rejected:', error)
      setPending(false)
    })
  }
  return (
    <Modal open onClose={close} closeLabel={t('close')} title={t('menu.deleteSession')}
      description={t('delete.session.desc', { title: request.displayTitle })}
      footer={<>
        <Button variant="outline" data-modal-autofocus disabled={pending} onClick={close}>{t('cancel')}</Button>
        <Button variant="outline" className={css.deleteAction} disabled={pending} onClick={confirm}>{t('delete')}</Button>
      </>}
    />
  )
}
