type BuildRoomQueryUrlOptions = {
  courseId: string;
  currentSearch: string;
  identity: string;
  inviteCode: string;
  isExternalInviteMode: boolean;
  name: string;
  pathname: string;
  presentationHref: string;
  room: string;
};

export const buildRoomQueryUrl = ({
  courseId,
  currentSearch,
  identity,
  inviteCode,
  isExternalInviteMode,
  name,
  pathname,
  presentationHref,
  room,
}: BuildRoomQueryUrlOptions) => {
  const params = new URLSearchParams(currentSearch);

  if (isExternalInviteMode) {
    if (inviteCode) {
      params.set('invite', inviteCode);
    }
    params.delete('course');
    params.delete('room');
    params.delete('identity');
    params.delete('name');
    params.delete('slides');
    params.delete('presentation');
  } else {
    if (courseId) {
      params.set('course', courseId);
    } else {
      params.delete('course');
    }

    params.set('room', room);
    params.set('identity', identity);

    if (name) {
      params.set('name', name);
    } else {
      params.delete('name');
    }

    if (presentationHref) {
      params.set('slides', presentationHref);
    } else {
      params.delete('slides');
    }
  }

  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
};
